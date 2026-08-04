import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import {
  addEvent,
  demoNow,
  getDb,
  initializeDatabaseConnection,
  newId,
  prepareOpenedDatabase,
  resetDemoDatabase,
  runDatabaseMigrations,
  setDbForTests
} from '../../server/utils/db'

/**
 * server/utils/db.ts 核心工具契约。
 *
 * 重点覆盖：
 *  - addEvent 默认值（opportunityId 空、data 缺失）→ JSON 字符串持久化正确
 *  - demoNow 走 demo_state.current_time，不踩 SQLite CURRENT_TIME 关键字
 *  - initializeDatabaseConnection 幂等（重复调用不抛错、不丢数据）
 *  - prepareOpenedDatabase 重启清理 queued/running/waiting → failed（核心防御）
 *  - prepareOpenedDatabase 不影响 completed/failed/stopped
 *  - runDatabaseMigrations BY004 幂等（跑两次不重复修复）
 *  - newId 唯一 + 带 prefix
 */
describe('DB-UTILS: server/utils/db.ts', () => {
  it('DB-001: addEvent 写入基础字段并使用 demo_state.current_time', () => {
    const { db } = useIsolatedDb()
    addEvent({
      customerId: 'customer-wca-01',
      type: 'unit_test_basic',
      title: '基础事件',
      description: '描述',
      source: 'system',
      data: { foo: 'bar', n: 1 }
    }, db)

    const row = db.prepare(`SELECT * FROM opportunity_events WHERE type = 'unit_test_basic'`).get() as any
    expect(row).toBeTruthy()
    expect(row.customer_id).toBe('customer-wca-01')
    expect(row.opportunity_id).toBe('')
    expect(row.title).toBe('基础事件')
    expect(row.description).toBe('描述')
    expect(row.source).toBe('system')
    expect(JSON.parse(row.data_json)).toEqual({ foo: 'bar', n: 1 })
    expect(row.created_at).toBe('2026-07-17T02:00:00.000Z')
  })

  it('DB-002: addEvent opportunityId 缺省 → 存为空串（非 null）', () => {
    const { db } = useIsolatedDb()
    addEvent({
      customerId: 'customer-wca-01',
      type: 'unit_test_no_opp',
      title: '无机会事件',
      source: 'human'
    }, db)
    const row = db.prepare(`SELECT * FROM opportunity_events WHERE type = 'unit_test_no_opp'`).get() as any
    expect(row.opportunity_id).toBe('')
    expect(row.data_json).toBe('{}')
  })

  it('DB-003: addEvent data 缺省 → data_json 是 "{}"（非 null）', () => {
    const { db } = useIsolatedDb()
    addEvent({
      customerId: 'customer-wca-01',
      type: 'unit_test_no_data',
      title: '无数据事件',
      source: 'agent'
    }, db)
    const row = db.prepare(`SELECT * FROM opportunity_events WHERE type = 'unit_test_no_data'`).get() as any
    expect(row.data_json).toBe('{}')
    expect(JSON.parse(row.data_json)).toEqual({})
  })

  it('DB-004: demoNow 走 demo_state.current_time，不返回系统时间', () => {
    const { db } = useIsolatedDb()
    // 改 demo_state 到一个明确非当前时刻的值
    db.prepare(`UPDATE demo_state SET current_time = ? WHERE id = 1`).run('2025-01-15T08:30:00.000Z')
    const now = demoNow(db)
    expect(now).toBe('2025-01-15T08:30:00.000Z')
    // 确认不是 new Date()（与现实时间错开）
    const wallClock = new Date().toISOString()
    expect(now).not.toBe(wallClock)
  })

  it('DB-005: demoNow 对引号包裹的列名解析正确（防御 CURRENT_TIME 关键字陷阱）', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE demo_state SET current_time = ? WHERE id = 1`).run('2024-12-31T23:59:59.000Z')
    // 直接用 SQLite 验证查询路径
    const direct = (db.prepare(`SELECT "current_time" FROM demo_state WHERE id = 1`).get() as any).current_time
    expect(direct).toBe('2024-12-31T23:59:59.000Z')
    expect(demoNow(db)).toBe(direct)
  })

  it('DB-006: initializeDatabaseConnection 幂等（重复调用不抛错、不丢数据）', () => {
    const { db } = useIsolatedDb()
    const before = Number((db.prepare('SELECT COUNT(*) AS c FROM customers').get() as any).c)
    // 第二次初始化同一连接
    expect(() => initializeDatabaseConnection(db, { seed: false })).not.toThrow()
    expect(() => initializeDatabaseConnection(db, { seed: true })).not.toThrow()
    const after = Number((db.prepare('SELECT COUNT(*) AS c FROM customers').get() as any).c)
    expect(after).toBeGreaterThanOrEqual(before)
  })

  it('DB-007: prepareOpenedDatabase 把 queued/running/waiting 全部标记为 failed（重启防御）', () => {
    const { db } = useIsolatedDb()
    db.prepare(`INSERT INTO agent_tasks
      (id, mode, target_type, target_id, status, phase, progress, current_step, model, input_json, result_json, created_at, started_at, completed_at)
      VALUES ('task-q', 'customer_profiling', 'customer', 'customer-wca-01', 'queued', 'requesting', 0, '', 'm', '{}', '{}', '2026-07-17T02:00:00.000Z', '', '')`).run()
    db.prepare(`INSERT INTO agent_tasks
      (id, mode, target_type, target_id, status, phase, progress, current_step, model, input_json, result_json, created_at, started_at, completed_at)
      VALUES ('task-r', 'product_matching', 'customer', 'customer-wca-02', 'running', 'thinking', 30, '', 'm', '{}', '{}', '2026-07-17T02:00:00.000Z', '', '')`).run()
    db.prepare(`INSERT INTO agent_tasks
      (id, mode, target_type, target_id, status, phase, progress, current_step, model, input_json, result_json, created_at, started_at, completed_at)
      VALUES ('task-w', 'outreach_drafting', 'opportunity', 'opp-01', 'waiting', 'executing', 60, '', 'm', '{}', '{}', '2026-07-17T02:00:00.000Z', '', '')`).run()

    prepareOpenedDatabase(db)

    const rows = db.prepare(`SELECT id, status, phase, error FROM agent_tasks WHERE id IN ('task-q', 'task-r', 'task-w')`).all() as any[]
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row.status).toBe('failed')
      expect(row.phase).toBe('failed')
      expect(row.error).toMatch(/重启|中断/)
    }
  })

  it('DB-008: prepareOpenedDatabase 不影响 completed / failed / stopped 状态', () => {
    const { db } = useIsolatedDb()
    db.prepare(`INSERT INTO agent_tasks
      (id, mode, target_type, target_id, status, phase, progress, current_step, model, error, input_json, result_json, created_at, started_at, completed_at)
      VALUES ('task-done', 'customer_profiling', 'customer', 'customer-wca-01', 'completed', 'completed', 100, 'done', 'm', '', '{}', '{}', '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z')`).run()
    db.prepare(`INSERT INTO agent_tasks
      (id, mode, target_type, target_id, status, phase, progress, current_step, model, error, input_json, result_json, created_at, started_at, completed_at)
      VALUES ('task-fail', 'customer_profiling', 'customer', 'customer-wca-01', 'failed', 'failed', 0, '', 'm', 'old error', '{}', '{}', '2026-07-17T02:00:00.000Z', '', '2026-07-17T02:00:00.000Z')`).run()
    db.prepare(`INSERT INTO agent_tasks
      (id, mode, target_type, target_id, status, phase, progress, current_step, model, error, input_json, result_json, created_at, started_at, completed_at)
      VALUES ('task-stop', 'customer_profiling', 'customer', 'customer-wca-01', 'stopped', 'stopped', 0, '', 'm', '', '{}', '{}', '2026-07-17T02:00:00.000Z', '', '2026-07-17T02:00:00.000Z')`).run()

    prepareOpenedDatabase(db)

    const rows = db.prepare(`SELECT id, status, error FROM agent_tasks WHERE id IN ('task-done', 'task-fail', 'task-stop')`).all() as any[]
    const byId = Object.fromEntries(rows.map(r => [r.id, r]))
    expect(byId['task-done'].status).toBe('completed')
    expect(byId['task-fail'].status).toBe('failed')
    expect(byId['task-fail'].error).toBe('old error')
    expect(byId['task-stop'].status).toBe('stopped')
  })

  it('DB-009: runDatabaseMigrations BY004 幂等（跑两次不重复修复）', () => {
    // 用一个不带 seed 的 isolated db，手工插入 BY004 published=1，pms_snapshot.published=true
    const { db } = useIsolatedDb(false)
    db.prepare(`INSERT INTO products
      (id, code, name, category, transport_mode, routes_json, cargo_types_json, capabilities_json,
       quote_ready, reference_price, transit_time, published, product_version, pms_snapshot_json, marketing_json, simulated, updated_at)
      VALUES ('product-by004', 'BY004', '美国空派中技全链路', '空运', '空派专线', '["中国-美国"]', '["普货"]', '["上门提货"]',
       0, '', '', 1, 1, ?, '{}', 0, '2026-07-17T02:00:00.000Z')`)
      .run(JSON.stringify({ code: 'BY004', published: true }))

    runDatabaseMigrations(db)
    const after1 = db.prepare(`SELECT published, pms_snapshot_json FROM products WHERE code = 'BY004'`).get() as any
    expect(Number(after1.published)).toBe(0)
    expect(JSON.parse(after1.pms_snapshot_json).published).toBe(false)

    // 第二次调用不应改变已修复的 BY004
    const snapshotBefore = after1.pms_snapshot_json
    const publishedBefore = after1.published
    runDatabaseMigrations(db)
    const after2 = db.prepare(`SELECT published, pms_snapshot_json FROM products WHERE code = 'BY004'`).get() as any
    expect(after2.published).toBe(publishedBefore)
    expect(after2.pms_snapshot_json).toBe(snapshotBefore)
  })

  it('DB-010: newId 每次返回不同 ID 且带 prefix', () => {
    const { db } = useIsolatedDb()
    const ids = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const id = newId('unit')
      expect(id.startsWith('unit-')).toBe(true)
      expect(id.length).toBeGreaterThan(10)
      ids.add(id)
    }
    expect(ids.size).toBe(50)

    // 与 db 模块状态解耦
    expect(getDb()).toBeTruthy()
  })

  it('DB-011: setDbForTests 切换后 getDb 返回新 db（模块级单例可重置）', () => {
    useIsolatedDb()
    const first = getDb()

    // 再开一个隔离 db，set 进去
    const { db: second, path: secondPath } = useIsolatedDb()
    expect(getDb()).toBe(second)
    expect(getDb()).not.toBe(first)
    expect(secondPath).toBeTruthy()
  })

  it('DB-012: resetDemoDatabase 幂等 + demo_state 恢复固定种子', () => {
    const { db } = useIsolatedDb()
    // 改坏
    db.prepare(`UPDATE demo_state SET current_time = ? WHERE id = 1`).run('1999-01-01T00:00:00.000Z')
    db.prepare(`DELETE FROM customers WHERE id = 'customer-wca-01'`).run()
    const beforeReset = Number((db.prepare('SELECT COUNT(*) AS c FROM customers').get() as any).c)
    expect(beforeReset).toBeLessThan(33)

    resetDemoDatabase(db)

    // 必须用引号包裹列名 — 否则 SQLite 会把它解析为 CURRENT_TIME 函数（这是 server/utils/db.ts demoNow
    // 显式写 "current_time" 防御的核心场景）
    const state = (db.prepare(`SELECT "current_time" FROM demo_state WHERE id = 1`).get() as any).current_time
    expect(state).toBe('2026-07-17T02:00:00.000Z')
    const afterReset = Number((db.prepare('SELECT COUNT(*) AS c FROM customers').get() as any).c)
    expect(afterReset).toBe(33)
  })
})
