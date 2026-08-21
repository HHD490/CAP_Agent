import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import { markNonAcceptedMatchesStale } from '../../server/utils/db'

/**
 * server/utils/db.ts 的 markNonAcceptedMatchesStale 合同级单测。
 *
 * 已有覆盖：
 *   - db-utils.test.ts:        DB 工具层通用（addEvent / demoNow / 初始化 / 重启清理 / migration）
 *   - product-publish.test.ts: BY004 不会被 product_matching 落库（含 accepted 保护的间接效果）
 *   - demo-action-stale.test.ts: update_customer / update_product 触发的 stale 联动
 *
 * 本文件补（直击函数本身）：
 *   - 客户无 match → noop（不报错）
 *   - 客户全部 accepted → noop（accepted 保护的关键合同）
 *   - 客户有 proposed/rejected/etc → 全部 stale=1
 *   - 自定义 now 生效
 *   - 默认 now 用 demoNow（保证与 agent.ts applyResult 时间口径一致）
 *   - 同 customerId 多次调用幂等
 *
 * 风险依据（test-scope.md §2 高风险表）：
 *   - accepted 匹配被错误 stale → 已签合同被重写
 */

const insertMatch = (db: any, id: string, customerId: string, status: string, productCode: string = 'BY001') => {
  const product = db.prepare('SELECT id FROM products WHERE code = ?').get(productCode) as any
  const customer = db.prepare('SELECT id, profile_version FROM customers WHERE id = ?').get(customerId) as any
  db.prepare(`INSERT INTO match_results (id, customer_id, product_id, score, confidence, evidence_json, risks_json, missing_json, blockers_json, customer_version, product_version, stale, status, created_at, updated_at)
    VALUES (?, ?, ?, 80, 'medium', '[]', '[]', '[]', '[]', ?, ?, 0, ?, ?, ?)`)
    .run(id, customerId, product.id, customer.profile_version, product.id, status, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')
}

describe('MATCH-STALE: markNonAcceptedMatchesStale 边界合同', () => {
  it('STALE-001: 客户无任何 match → noop（不抛错，返回 undefined）', () => {
    const { db } = useIsolatedDb()
    expect(() => markNonAcceptedMatchesStale('customer-wca-99', db)).not.toThrow()
    const all = db.prepare('SELECT COUNT(*) c FROM match_results WHERE customer_id = ?').get('customer-wca-99') as any
    expect(Number(all.c)).toBe(0)
  })

  it('STALE-002: 客户全部 accepted → 0 行被改（accepted 保护的核心合同）', () => {
    const { db } = useIsolatedDb()
    // 选 customer-wca-10：种子没给它预置 match，避免干扰
    // UNIQUE(customer_id, product_id, customer_version, product_version) → 用不同 product
    insertMatch(db, 'm-acc-1', 'customer-wca-10', 'accepted', 'BY001')
    insertMatch(db, 'm-acc-2', 'customer-wca-10', 'accepted', 'BY002')

    const beforeUpdated = db.prepare(`SELECT id, updated_at FROM match_results WHERE customer_id = 'customer-wca-10' ORDER BY id`).all() as any[]

    markNonAcceptedMatchesStale('customer-wca-10', db)

    const after = db.prepare(`SELECT id, stale, updated_at FROM match_results WHERE customer_id = 'customer-wca-10' ORDER BY id`).all() as any[]
    for (const row of after) {
      expect(Number(row.stale), `${row.id} (accepted) must not be marked stale`).toBe(0)
      const beforeRow = beforeUpdated.find(b => b.id === row.id)
      expect(row.updated_at, `${row.id} updated_at must not change`).toBe(beforeRow.updated_at)
    }
  })

  it('STALE-003: 客户含 proposed/rejected/superseded 等非 accepted → 全部 stale=1', () => {
    const { db } = useIsolatedDb()
    // 选 customer-wca-03：种子没给它预置 match
    // UNIQUE(customer_id, product_id, customer_version, product_version) → 用不同 product
    insertMatch(db, 'm-prop-1', 'customer-wca-03', 'proposed', 'BY001')
    insertMatch(db, 'm-rej-1', 'customer-wca-03', 'rejected', 'BY002')
    insertMatch(db, 'm-sup-1', 'customer-wca-03', 'superseded', 'BY003')
    insertMatch(db, 'm-acc-1', 'customer-wca-03', 'accepted', 'SIM012') // 锚定：这条不该被改

    markNonAcceptedMatchesStale('customer-wca-03', db)

    const rows = db.prepare(`SELECT id, status, stale FROM match_results WHERE customer_id = 'customer-wca-03' ORDER BY id`).all() as any[]
    for (const row of rows) {
      if (row.id === 'm-acc-1') {
        expect(Number(row.stale), 'accepted must stay 0').toBe(0)
      } else {
        expect(Number(row.stale), `${row.id} (${row.status}) must be marked stale`).toBe(1)
      }
    }
  })

  it('STALE-004: 自定义 now → updated_at 写入自定义值（防御时区/格式漂移）', () => {
    const { db } = useIsolatedDb()
    insertMatch(db, 'm-prop-1', 'customer-wca-03', 'proposed')

    const customNow = '2026-08-15T12:34:56.789Z'
    markNonAcceptedMatchesStale('customer-wca-03', db, customNow)

    const row = db.prepare(`SELECT stale, updated_at FROM match_results WHERE id = 'm-prop-1'`).get() as any
    expect(Number(row.stale)).toBe(1)
    expect(row.updated_at).toBe(customNow)
  })

  it('STALE-005: 默认 now 用 demoNow（不传第三个参数时不报错且 updated_at 是 demoNow 格式）', () => {
    const { db } = useIsolatedDb()
    insertMatch(db, 'm-prop-1', 'customer-wca-04', 'proposed')

    markNonAcceptedMatchesStale('customer-wca-04', db) // 不传 now

    const row = db.prepare(`SELECT stale, updated_at FROM match_results WHERE id = 'm-prop-1'`).get() as any
    expect(Number(row.stale)).toBe(1)
    // demoNow 在测试中应返回 ISO 字符串
    expect(String(row.updated_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('STALE-006: 同 customerId 多次调用幂等（第二次不抛错、stale 仍为 1）', () => {
    const { db } = useIsolatedDb()
    insertMatch(db, 'm-prop-1', 'customer-wca-05', 'proposed')

    markNonAcceptedMatchesStale('customer-wca-05', db)
    markNonAcceptedMatchesStale('customer-wca-05', db)
    markNonAcceptedMatchesStale('customer-wca-05', db)

    const row = db.prepare(`SELECT stale FROM match_results WHERE id = 'm-prop-1'`).get() as any
    expect(Number(row.stale)).toBe(1)
  })

  it('STALE-007: 不传 db 参数 → 使用 getDb() 当前实例（与 call site 行为一致）', () => {
    const { db } = useIsolatedDb()
    insertMatch(db, 'm-prop-1', 'customer-wca-06', 'proposed')

    // 不传 db —— 必须走 getDb() 且能拿到测试已 set 的实例
    markNonAcceptedMatchesStale('customer-wca-06')

    const row = db.prepare(`SELECT stale FROM match_results WHERE id = 'm-prop-1'`).get() as any
    expect(Number(row.stale)).toBe(1)
  })

  it('STALE-008: 客户不存在 → noop（不抛错，不影响其它客户）', () => {
    const { db } = useIsolatedDb()
    insertMatch(db, 'm-prop-1', 'customer-wca-01', 'proposed')

    expect(() => markNonAcceptedMatchesStale('customer-totally-fake', db)).not.toThrow()

    // 其它客户的 match 不受影响
    const row = db.prepare(`SELECT stale FROM match_results WHERE id = 'm-prop-1'`).get() as any
    expect(Number(row.stale), 'unrelated customer must stay 0').toBe(0)
  })
})
