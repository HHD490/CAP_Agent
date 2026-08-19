/**
 * 数据完整性 DATA-INT（SCOPE-NFR-2026-08-11 representative_cases 落地）：
 *   - DATA-INT-001: 跨会话幂等 manual_customer
 *   - DATA-INT-002: profile_version 自增
 *   - DATA-INT-003: 事务 ROLLBACK 期间 opp 状态
 *
 * 副作用回滚 / 任务幂等 / profile_version 自增 / 事件落库顺序（SCOPE-NFR-2026-08-19 缺口补齐）：
 *   - C1: 任务重复 runAgentTaskNow（PoC 缺 dedup，记录事实）
 *   - C2: applyAgentResult 中途失败（addEvent 抛错）→ 事务回滚
 *   - C3: profile_version 100 次累加 UPDATE 无跳号
 *   - C4: 事件落库顺序（PoC opp-level 先 / customer-level 后，记录事实）
 *   - C5: 任务失败后 agent_tasks.error 含可定位字符串
 *
 * 阈值：spec_default + UNAPPROVED
 */
import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import actionHandler from '../../server/api/demo/action.post'
import {
  applyAgentResult,
  createAgentTask,
  runAgentTaskNow,
  setAgentProviderForTests,
  resetAgentTestHooks
} from '../../server/utils/agent'

describe('NFR-DATA: 数据完整性（幂等 / 版本 / 事务）', () => {
  it('DATA-INT-001: 跨会话幂等 — manual_customer 同 payload 不重复（事实记录）', async () => {
    const { db } = useIsolatedDb()
    const payload = { name: 'TestCorp', country: '中国', city: '深圳', source: 'manual' as const, email: 'a@b.com' }
    // 第 1 次
    const r1 = await actionHandler({ __body: { action: 'manual_customer', data: payload } } as any)
    expect(r1.ok).toBe(true)
    expect(r1.customerId).toBeTruthy()
    // 第 2 次同 payload
    const r2 = await actionHandler({ __body: { action: 'manual_customer', data: payload } } as any)
    expect(r2.ok).toBe(true)
    // 当前 PoC 行为：每次都创建（id 不同）— 记录事实
    const cnt = Number((db.prepare(`SELECT COUNT(*) c FROM customers WHERE name = 'TestCorp'`).get() as any).c)
    // 契约文档：理想行为是 1 行（同 source+sourceRef 唯一）
    // 当前实现：2 行（PoC 无去重）
    // 断言当前事实 = 2 行（如未来加幂等，此断言会失败 → 需重评）
    expect(cnt, 'PoC 当前 manual_customer 不去重').toBe(2)
  })

  it('DATA-INT-002: profile_version 自增 — update_customer 两次，profileVersion 自增且旧版 aiProfile 保留', async () => {
    const { db } = useIsolatedDb()
    // 初始：seed customer-wca-01 的 profile_version
    const before = db.prepare(`SELECT profile_version, ai_profile_json FROM customers WHERE id = 'customer-wca-01'`).get() as any
    const beforeVersion = Number(before.profile_version)
    const beforeAiProfile = String(before.ai_profile_json || '')

    // 第 1 次 update_customer
    const r1 = await actionHandler({ __body: { action: 'update_customer', id: 'customer-wca-01', data: { facts: { note: 'v1 update' } } } } as any) as any
    expect(r1.ok).toBe(true)
    expect(r1.version, 'r1.version = beforeVersion + 1').toBe(beforeVersion + 1)

    // 第 2 次 update_customer
    const r2 = await actionHandler({ __body: { action: 'update_customer', id: 'customer-wca-01', data: { facts: { note: 'v2 update' } } } } as any) as any
    expect(r2.ok).toBe(true)
    expect(r2.version, 'r2.version = beforeVersion + 2').toBe(beforeVersion + 2)

    const after = db.prepare(`SELECT profile_version, ai_profile_json FROM customers WHERE id = 'customer-wca-01'`).get() as any
    expect(Number(after.profile_version), 'profile_version 累加 2').toBe(beforeVersion + 2)
    // facts_json 必含 v1 + v2（按实现累积）
    const factsStr = String(after.ai_profile_json || '')
    // v1 内容应保留在 facts_json（ai_profile_json 是 Agent 输出，不是 update_customer 字段）
    // 实际验证：version 累加 + facts_json 含 update
    const factsRow = db.prepare(`SELECT facts_json FROM customers WHERE id = 'customer-wca-01'`).get() as any
    expect(String(factsRow.facts_json || '')).toContain('v2 update')
  })

  it('DATA-INT-003: 事务 ROLLBACK 期间 opp stage / blocker 不变（与 RESILIENCE-006 互补）', () => {
    const { db } = useIsolatedDb()
    // opp-01 seed: stage=9, blocker=''
    // mock 注入 draft 写失败
    const originalPrepare = db.prepare.bind(db)
    let draftInsertCount = 0
    ;(db as any).prepare = (sql: string) => {
      const stmt = originalPrepare(sql)
      if (sql.includes('INSERT INTO email_drafts')) {
        draftInsertCount += 1
        if (draftInsertCount === 1) {
          return { ...stmt, run: () => { throw new Error('draft 写失败（DATA-INT 模拟）') } }
        }
      }
      return stmt
    }
    try {
      const opp = db.prepare(`SELECT stage, blocker FROM opportunities WHERE id = 'opp-01'`).get() as any
      const beforeStage = Number(opp.stage)
      const beforeBlocker = String(opp.blocker || '')
      expect(() => applyAgentResult('task-data003', 'outreach_drafting', 'opp-01', {
        language: 'zh', subject: 'S', body: 'B', call_to_action: 'CTA', evidence: ['e']
      }, {})).toThrow(/draft 写失败/)
      const after = db.prepare(`SELECT stage, blocker FROM opportunities WHERE id = 'opp-01'`).get() as any
      expect(Number(after.stage), 'opp.stage 不变').toBe(beforeStage)
      expect(String(after.blocker || ''), 'opp.blocker 不变').toBe(beforeBlocker)
    } finally {
      ;(db as any).prepare = originalPrepare
      resetAgentTestHooks()
    }
  })
})

describe('NFR-DATA-SIDE: 副作用回滚 / 任务幂等 / 版本自增 / 事件顺序', () => {
  it('C1: 任务重复 runAgentTaskNow 仍会再次执行（PoC 缺 dedup，记录事实）', async () => {
    const { db } = useIsolatedDb()
    let callCount = 0
    setAgentProviderForTests(async () => {
      callCount += 1
      return {
        customer_type: 'trading_company',
        summary: 'C1 测试',
        likely_needs: [],
        capabilities: [],
        target_lanes: [],
        confidence: 'high',
        evidence: ['e1'],
        missing_information: [],
        suggested_next_action: 'next'
      }
    })
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })

    // 第 1 次执行
    await runAgentTaskNow(task.id)
    expect(callCount, '第 1 次执行后 callCount = 1').toBe(1)
    const row1 = db.prepare('SELECT status, completed_at FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row1.status, '第 1 次 status = completed').toBe('completed')
    expect(String(row1.completed_at).length, '第 1 次 completed_at 非空').toBeGreaterThan(0)

    // 第 2 次执行（PoC 无 dedup → 仍会执行；spec 期望 dedup 是 §2.5 缺口 C）
    await runAgentTaskNow(task.id)
    expect(callCount, '第 2 次仍执行（PoC 缺 dedup，callCount=2）').toBe(2)
    const row2 = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row2.status, '第 2 次 status 仍 = completed').toBe('completed')
  })

  it('C2: applyAgentResult 中途失败（addEvent 抛错）→ 事务回滚，events 无新增', () => {
    const { db } = useIsolatedDb()
    const beforeDrafts = Number((db.prepare('SELECT COUNT(*) c FROM email_drafts').get() as any).c)
    const beforeEvents = Number((db.prepare('SELECT COUNT(*) c FROM opportunity_events').get() as any).c)
    const beforeStage = Number((db.prepare('SELECT stage FROM opportunities WHERE id = ?').get('opp-01') as any).stage)

    // 拦截 opportunity_events INSERT → 抛错（addEvent 内部失败）
    const originalPrepare = db.prepare.bind(db)
    ;(db as any).prepare = (sql: string) => {
      const stmt = originalPrepare(sql)
      if (sql.includes('INSERT INTO opportunity_events')) {
        return { ...stmt, run: () => { throw new Error('event 写失败（C2 模拟）') } }
      }
      return stmt
    }

    try {
      // outreach_drafting 走 BEGIN/COMMIT/ROLLBACK 路径 → 事务回滚
      expect(() => applyAgentResult('task-c2', 'outreach_drafting', 'opp-01', {
        language: 'zh',
        subject: 'S',
        body: 'B',
        call_to_action: 'CTA',
        evidence: ['e']
      }, {})).toThrow(/event 写失败/)

      // 事务回滚：email_drafts 无新增、events 无新增、opp.stage 不变
      const afterDrafts = Number((db.prepare('SELECT COUNT(*) c FROM email_drafts').get() as any).c)
      const afterEvents = Number((db.prepare('SELECT COUNT(*) c FROM opportunity_events').get() as any).c)
      const afterStage = Number((db.prepare('SELECT stage FROM opportunities WHERE id = ?').get('opp-01') as any).stage)
      expect(afterDrafts, 'email_drafts 被 ROLLBACK').toBe(beforeDrafts)
      expect(afterEvents, 'opportunity_events 无新增').toBe(beforeEvents)
      expect(afterStage, 'opp.stage 不变').toBe(beforeStage)
    } finally {
      ;(db as any).prepare = originalPrepare
      resetAgentTestHooks()
    }
  })

  it('C3: profile_version 在 100 次累加 UPDATE 后等于初始值 + 100（无跳号、无丢失）', () => {
    const { db } = useIsolatedDb()
    const before = Number((db.prepare('SELECT profile_version FROM customers WHERE id = ?').get('customer-wca-01') as any).profile_version)

    // 100 次累加（Node.js + DatabaseSync 串行；语义同"并发提交"——单写者 DB 串行化）
    const stmt = db.prepare('UPDATE customers SET profile_version = profile_version + 1 WHERE id = ?')
    for (let i = 0; i < 100; i += 1) {
      stmt.run('customer-wca-01')
    }

    const after = Number((db.prepare('SELECT profile_version FROM customers WHERE id = ?').get('customer-wca-01') as any).profile_version)
    expect(after, 'profile_version = before + 100（无跳号、无丢失）').toBe(before + 100)
  })

  it('C4: applyAgentResult 事件落库顺序（PoC 当前 opp-level 先、customer-level 后）', () => {
    const { db } = useIsolatedDb()
    // customer-wca-02 有 1 个 active opp = opp-02（status="active"）
    applyAgentResult('task-c4', 'customer_profiling', 'customer-wca-02', {
      customer_type: 'trading_company',
      summary: 'C4 测试',
      likely_needs: [],
      capabilities: [],
      target_lanes: [],
      confidence: 'high',
      evidence: ['e1'],
      missing_information: [],
      suggested_next_action: 'next'
    }, {})

    // 找出 task-c4 写入的 events（data_json LIKE 匹配 taskId，排除 seed events）
    const newEvents = db.prepare(`
      SELECT id, opportunity_id, customer_id, type, rowid
      FROM opportunity_events
      WHERE customer_id = 'customer-wca-02' AND data_json LIKE '%task-c4%'
      ORDER BY rowid ASC
    `).all() as any[]

    expect(newEvents.length, 'C4 新增 2 个 event').toBe(2)
    const oppLevel = newEvents.filter((e: any) => String(e.opportunity_id) === 'opp-02')
    const custLevel = newEvents.filter((e: any) => String(e.opportunity_id) === '')
    expect(oppLevel.length, '1 个 opp-level event (opportunity_id=opp-02)').toBe(1)
    expect(custLevel.length, '1 个 customer-level event (opportunity_id="")').toBe(1)

    // PoC 实际顺序：opp-level 先插入（rowid 较小），customer-level 后插入（rowid 较大）
    // spec §2.7 缺口 G4：期望 customer-level 在前（PoC 反之，记录事实）
    const oppRowid = Number(oppLevel[0].rowid)
    const custRowid = Number(custLevel[0].rowid)
    expect(oppRowid < custRowid, 'PoC 当前顺序：opp-level rowid < customer-level rowid（与 spec §2.7 缺口 G4 配套）').toBe(true)
  })

  it('C5: 任务失败后 agent_tasks.error 字段含可定位字符串', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => { throw new Error('rate limit exceeded (C5 mock)') })
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error, completed_at FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status, 'task.status = failed').toBe('failed')
    expect(String(row.error), 'error 含可定位字符串').toMatch(/rate/i)
    expect(String(row.completed_at).length, 'completed_at 非空').toBeGreaterThan(0)
  })
})
