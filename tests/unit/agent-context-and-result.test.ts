import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import {
  applyAgentResult,
  buildTargetContext,
  getAgentCustomerTypes,
  getAgentSchemas
} from '../../server/utils/agent'
import type { AgentMode } from '../../shared/types'

/**
 * server/utils/agent.ts 的 buildTargetContext / applyAgentResult 合同级单测。
 *
 * 已有覆盖：
 *   - agent-lifecycle.test.ts: 状态机、cascade、step 留痕
 *   - product-publish.test.ts:  BY004 不会被 product_matching context 收录（单条）
 *   - agent-schemas.test.ts:     schema 字段级校验
 *
 * 本文件补：
 *   - buildTargetContext 5 个 mode 的返回值结构、缺对象抛错、contact_id 缺失退化、operator_input 透传
 *   - applyAgentResult 5 个 mode 的副作用（customers / match_results / email_drafts / opportunities
 *     实际写入 + 阶段推进 + 事件写入 + 业务约束：硬阻断、accepted 保护、未发布拒绝、missing_contact、英文不升阶段）
 *   - getAgentSchemas / getAgentCustomerTypes registry 合同
 *
 * 风险依据（来自 test-scope.md §2 高风险表）：
 *   - 5 个 mode 任一字段映射/抛错条件漂移会让 demo-action / lifecycle 隐式走错
 *   - reply_qualification intent 错判 → 客户进错阶段、丢单
 *   - accepted 保护 → 已签合同被覆盖
 *   - BY004 → 未发布产品被误匹配
 *   - missing_contact → 邮件发不出去 / 错发
 *
 * 注意：applyAgentResult 是 agent.ts 的纯副作用函数（不通过 runAgentTaskNow 走 Provider），
 *       所以可以直接调用并以 DB 状态作为唯一判据，不依赖 mock provider。
 */

const profilePayload = (overrides: Record<string, any> = {}) => ({
  customer_type: 'trading_company',
  summary: '测试客户画像',
  likely_needs: ['中国出口运力'],
  capabilities: ['清关'],
  target_lanes: ['中国-美国'],
  confidence: 'high',
  evidence: ['公司服务范围'],
  missing_information: [],
  suggested_next_action: '进入产品匹配',
  ...overrides
})

const matchPayload = (overrides: { matches?: any[] } = {}) => ({
  matches: overrides.matches ?? [{
    product_code: 'BY001',
    fit_score: 88,
    confidence: 'high',
    evidence: ['美国方向'],
    risks: [],
    missing_information: [],
    hard_blockers: []
  }]
})

const draftPayload = (overrides: Record<string, any> = {}) => ({
  language: 'zh',
  subject: '建联主题',
  body: '您好，我们是中国到美国的物流服务商。',
  evidence: ['运力匹配'],
  call_to_action: '本周电话沟通？',
  ...overrides
})

const replyPayload = (overrides: Record<string, any> = {}) => ({
  intent: 'explicit',
  confidence: 'high',
  evidence: ['客户给到具体货量'],
  summary: '客户明确询价',
  next_action: '分配负责人',
  ...overrides
})

const handoffPayload = (overrides: Record<string, any> = {}) => ({
  summary: '交接摘要',
  customer_need: '美东大客户空派专线',
  recommended_product: { product_code: 'BY001', product_name: '美东大客户空派专线' },
  evidence: ['客户需求'],
  risks: ['价格敏感'],
  next_steps: ['3 天内联系客户'],
  ...overrides
})

describe('AGENT-CTX: buildTargetContext 5 mode 上下文构造合同', () => {
  it('CTX-001: customer_profiling + 不存在客户 → throws 客户不存在', () => {
    useIsolatedDb()
    expect(() => buildTargetContext('customer_profiling', 'customer-does-not-exist'))
      .toThrow(/客户不存在/)
  })

  it('CTX-002: customer_profiling + 存在客户 → 返回 customer 块（id/name/source/country/city/type + 三套 JSON + contacts）', () => {
    const { db } = useIsolatedDb()
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get('customer-wca-01') as any
    expect(customer).toBeTruthy()

    const ctx = buildTargetContext('customer_profiling', 'customer-wca-01') as any
    expect(ctx.customer).toBeTruthy()
    expect(ctx.customer.id).toBe('customer-wca-01')
    expect(ctx.customer.name).toBe(customer.name)
    expect(ctx.customer.source).toBe(customer.source)
    expect(ctx.customer.country).toBe(customer.country)
    expect(ctx.customer.city).toBe(customer.city)
    expect(ctx.customer.type).toBe(customer.customer_type)
    expect(ctx.customer.profile_version).toBe(customer.profile_version)
    // 三套 JSON 必须被 JSON.parse 还原为对象
    expect(typeof ctx.customer.raw_source).toBe('object')
    expect(typeof ctx.customer.standardized_facts).toBe('object')
    expect(typeof ctx.customer.previous_ai_profile).toBe('object')
    // contacts 必须是数组
    expect(Array.isArray(ctx.customer.contacts)).toBe(true)
  })

  it('CTX-003: product_matching + 不存在客户 → throws 客户不存在（与 profiling 同源）', () => {
    useIsolatedDb()
    expect(() => buildTargetContext('product_matching', 'customer-does-not-exist'))
      .toThrow(/客户不存在/)
  })

  it('CTX-004: product_matching + 存在客户 → 返回 base + products（仅 published）+ deterministic_filter', () => {
    const { db } = useIsolatedDb()
    const allProducts = db.prepare('SELECT code, published FROM products').all() as any[]
    const published = allProducts.filter(p => Number(p.published) === 1)
    expect(published.length).toBeGreaterThan(0)
    expect(allProducts.length).toBeGreaterThan(published.length) // 种子有未发布产品，测试才有意义

    const ctx = buildTargetContext('product_matching', 'customer-wca-01') as any
    expect(ctx.customer).toBeTruthy()
    expect(Array.isArray(ctx.products)).toBe(true)
    // 关键合同：只含已发布产品
    const codes = ctx.products.map((p: any) => p.code)
    for (const code of codes) {
      const row = db.prepare('SELECT published FROM products WHERE code = ?').get(code) as any
      expect(Number(row.published), `product ${code} must be published`).toBe(1)
    }
    expect(codes.length).toBe(published.length)
    // deterministic_filter 必须存在且是字符串（模型不能伪造过滤规则）
    expect(typeof ctx.deterministic_filter).toBe('string')
    expect(ctx.deterministic_filter.length).toBeGreaterThan(0)
  })

  it('CTX-005: product_matching + 所有产品都未发布 → products=[]（空数组，不是 null/undefined）', () => {
    const { db } = useIsolatedDb()
    db.prepare('UPDATE products SET published = 0').run()

    const ctx = buildTargetContext('product_matching', 'customer-wca-01') as any
    expect(ctx.products).toEqual([])
    // 关键：products 是 [] 时 deterministic_filter 仍然存在（防御模型走非空判断）
    expect(typeof ctx.deterministic_filter).toBe('string')
  })

  it('CTX-006: outreach_drafting + opportunity 不存在 → throws 获客机会不存在', () => {
    useIsolatedDb()
    expect(() => buildTargetContext('outreach_drafting', 'opp-does-not-exist'))
      .toThrow(/获客机会不存在/)
  })

  it('CTX-007: outreach_drafting + opportunity 无 contact_id → contact: null（不抛错）', () => {
    const { db } = useIsolatedDb()
    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = ?`).get('opp-01') as any
    expect(opp).toBeTruthy()
    db.prepare('UPDATE opportunities SET contact_id = ? WHERE id = ?').run('', 'opp-01')

    const ctx = buildTargetContext('outreach_drafting', 'opp-01', { language: 'en' }) as any
    expect(ctx.opportunity).toBeTruthy()
    expect(ctx.opportunity.id).toBe('opp-01')
    // 关键合同：contact 字段是 null，不是 undefined，便于模型做存在性判断
    expect(ctx.contact).toBeNull()
    // operator_input 透传
    expect(ctx.operator_input).toEqual({ language: 'en' })
  })

  it('CTX-008: outreach_drafting + opportunity 有 contact_id → contact 字段填充（name/title/email/status）', () => {
    const { db } = useIsolatedDb()
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-01') as any
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(opp.contact_id) as any
    expect(contact, 'seed opp-01 must have a contact').toBeTruthy()

    const ctx = buildTargetContext('outreach_drafting', 'opp-01') as any
    expect(ctx.contact).toBeTruthy()
    expect(ctx.contact.name).toBe(contact.name)
    expect(ctx.contact.title).toBe(contact.title)
    expect(ctx.contact.email).toBe(contact.email)
    expect(ctx.contact.status).toBe(contact.status)
  })

  it('CTX-009: outreach_drafting → 返回 timeline（最多 30 条）和 drafts（按 version DESC）', () => {
    const { db } = useIsolatedDb()
    // 注入 31 条事件，验证 LIMIT 30 截断
    const base = Date.now()
    for (let i = 0; i < 31; i++) {
      db.prepare(`INSERT INTO opportunity_events (id, opportunity_id, customer_id, type, title, description, source, created_at)
        VALUES (?, 'opp-01', ?, 'test_event', 'e${i}', 'd', 'human', ?)`)
        .run(`evt-${i}`, 'customer-wca-01', new Date(base - i * 1000).toISOString())
    }
    const ctx = buildTargetContext('outreach_drafting', 'opp-01') as any
    expect(Array.isArray(ctx.timeline)).toBe(true)
    expect(ctx.timeline.length).toBeLessThanOrEqual(30)
    // drafts 数组
    expect(Array.isArray(ctx.drafts)).toBe(true)
  })

  it('CTX-010: reply_qualification / handoff_summary → 与 outreach_drafting 同结构（共用 targetContext 路径）', () => {
    const ctxReply = buildTargetContext('reply_qualification', 'opp-01') as any
    const ctxHandoff = buildTargetContext('handoff_summary', 'opp-01') as any

    // 关键合同：opportunity/customer/product/timeline/drafts 都存在
    for (const [name, ctx] of [['reply_qualification', ctxReply], ['handoff_summary', ctxHandoff]] as const) {
      expect(ctx.opportunity, `${name} must include opportunity`).toBeTruthy()
      expect(ctx.customer, `${name} must include customer`).toBeTruthy()
      expect(ctx.product, `${name} must include product`).toBeTruthy()
      expect(Array.isArray(ctx.timeline), `${name} must include timeline array`).toBe(true)
      expect(Array.isArray(ctx.drafts), `${name} must include drafts array`).toBe(true)
    }
  })
})

describe('AGENT-RESULT: applyAgentResult 5 mode 副作用合同', () => {
  // ── customer_profiling ─────────────────────────────────────────
  it('RES-001: customer_profiling → customers.customer_type + ai_profile_status="suggested" + 推进 demo 时钟后 last_activity_at/updated_at 都更新', () => {
    const { db } = useIsolatedDb()
    const before = db.prepare('SELECT * FROM customers WHERE id = ?').get('customer-wca-01') as any

    // 推进 demo 时钟：seed 把 current_time 固定在 2026-07-17，不推进就看不到 updated_at 变化
    db.prepare('UPDATE demo_state SET current_time = ? WHERE id = 1').run('2026-08-07T10:00:00.000Z')

    applyAgentResult('task-001', 'customer_profiling', 'customer-wca-01', profilePayload(), {})

    const after = db.prepare('SELECT * FROM customers WHERE id = ?').get('customer-wca-01') as any
    expect(after.customer_type).toBe('trading_company')
    expect(after.ai_profile_status).toBe('suggested')
    expect(after.last_activity_at).toBe('2026-08-07T10:00:00.000Z')
    expect(after.updated_at).toBe('2026-08-07T10:00:00.000Z')
    expect(after.updated_at).not.toBe(before.updated_at)
  })

  it('RES-002: customer_profiling → ai_profile_json 包含 generatedByTaskId 与 evidence', () => {
    const { db } = useIsolatedDb()
    applyAgentResult('task-002', 'customer_profiling', 'customer-wca-02', profilePayload(), {})

    const profile = JSON.parse(db.prepare('SELECT ai_profile_json FROM customers WHERE id = ?').get('customer-wca-02').ai_profile_json || '{}')
    expect(profile.generatedByTaskId).toBe('task-002')
    expect(profile.summary).toBe('测试客户画像')
    expect(profile.customerType).toBe('trading_company')
    expect(Array.isArray(profile.evidence)).toBe(true)
  })

  it('RES-003: customer_profiling → 存在 active opp stage<2 → 升级到 2 + next_action 已设', () => {
    const { db } = useIsolatedDb()
    // opp-01 默认 stage=1
    db.prepare(`UPDATE opportunities SET stage = 1, status = 'active' WHERE id = 'opp-01'`).run()

    applyAgentResult('task-003', 'customer_profiling', 'customer-wca-01', profilePayload(), {})

    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-01'`).get() as any
    expect(Number(opp.stage)).toBe(2)
    expect(String(opp.next_action)).toMatch(/产品匹配/)
  })

  it('RES-004: customer_profiling → 存在 active opp stage>=2 → 不降级', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET stage = 4, status = 'active', next_action = '保持' WHERE id = 'opp-01'`).run()

    applyAgentResult('task-004', 'customer_profiling', 'customer-wca-01', profilePayload(), {})

    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-01'`).get() as any
    expect(Number(opp.stage)).toBe(4) // 不降
    expect(opp.next_action).toBe('保持')
  })

  it('RES-005: customer_profiling → 写入 profile_completed 事件（含 evidence + taskId）', () => {
    const { db } = useIsolatedDb()
    applyAgentResult('task-005', 'customer_profiling', 'customer-wca-01', profilePayload(), {})

    const evts = db.prepare(`SELECT * FROM opportunity_events WHERE customer_id = 'customer-wca-01' AND type = 'profile_completed'`).all() as any[]
    expect(evts.length).toBeGreaterThan(0)
    const evt = evts[evts.length - 1]
    const data = JSON.parse(evt.data_json || '{}')
    expect(data.taskId).toBe('task-005')
    expect(Array.isArray(data.evidence)).toBe(true)
  })

  // ── product_matching ─────────────────────────────────────────
  it('RES-006: product_matching → 全部 product_code 不存在 → throws 没有可用的已发布产品匹配结果', () => {
    useIsolatedDb()
    expect(() => applyAgentResult('task-006', 'product_matching', 'customer-wca-01', matchPayload({ matches: [{
      product_code: 'NONEXIST-XYZ', fit_score: 90, confidence: 'high', evidence: ['x'], risks: [], missing_information: [], hard_blockers: []
    }] }), {}))
      .toThrow(/没有可用的已发布产品匹配结果/)
  })

  it('RES-007: product_matching → 部分 published → 只插 published 的，BY004 永不落库', () => {
    const { db } = useIsolatedDb()
    // BY004 在种子里 published=0，但代码里如果改错可能漏过——直接构造 mixed
    applyAgentResult('task-007', 'product_matching', 'customer-wca-10', matchPayload({ matches: [
      { product_code: 'BY001', fit_score: 88, confidence: 'high', evidence: ['ok'], risks: [], missing_information: [], hard_blockers: [] },
      { product_code: 'BY004', fit_score: 99, confidence: 'high', evidence: ['bad'], risks: [], missing_information: [], hard_blockers: [] }
    ] }), {})

    const by001 = db.prepare(`SELECT mr.* FROM match_results mr JOIN products p ON p.id = mr.product_id WHERE mr.customer_id = ? AND p.code = 'BY001'`).get('customer-wca-10') as any
    const by004 = db.prepare(`SELECT mr.* FROM match_results mr JOIN products p ON p.id = mr.product_id WHERE mr.customer_id = ? AND p.code = 'BY004'`).get('customer-wca-10') as any
    expect(by001, 'BY001 published must be inserted').toBeTruthy()
    expect(by004, 'BY004 unpublished must NOT be inserted').toBeFalsy()
  })

  it('RES-008: product_matching → 标 stale 非 accepted 的旧 match（accepted 保护）', () => {
    const { db } = useIsolatedDb()
    // 给 customer-wca-10 注入 2 条旧 match（accepted + proposed），用不同 product 避免 UNIQUE 冲突
    const by001 = db.prepare(`SELECT id FROM products WHERE code = 'BY001'`).get() as any
    const by002 = db.prepare(`SELECT id FROM products WHERE code = 'BY002'`).get() as any
    const customer = db.prepare(`SELECT id, profile_version FROM customers WHERE id = ?`).get('customer-wca-10') as any
    const product = db.prepare(`SELECT id, product_version FROM products WHERE code = 'BY001'`).get() as any
    db.prepare(`INSERT INTO match_results (id, customer_id, product_id, score, confidence, evidence_json, risks_json, missing_json, blockers_json, customer_version, product_version, stale, status, created_at, updated_at)
      VALUES (?, ?, ?, 70, 'low', '[]', '[]', '[]', '[]', ?, ?, 0, 'accepted', ?, ?)`)
      .run('match-old-1', 'customer-wca-10', by001.id, customer.profile_version, product.product_version, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')
    // 再注入一条非 accepted 的旧 match（应被标 stale）—— 用 BY002 避免 UNIQUE 冲突
    db.prepare(`INSERT INTO match_results (id, customer_id, product_id, score, confidence, evidence_json, risks_json, missing_json, blockers_json, customer_version, product_version, stale, status, created_at, updated_at)
      VALUES (?, ?, ?, 70, 'low', '[]', '[]', '[]', '[]', ?, ?, 0, 'proposed', ?, ?)`)
      .run('match-old-2', 'customer-wca-10', by002.id, customer.profile_version, by002.id, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')

    // matchPayload 默认是 BY001：ON CONFLICT 路径会更新 score/confidence，status 保留为 'accepted'
    applyAgentResult('task-008', 'product_matching', 'customer-wca-10', matchPayload(), {})

    const accepted = db.prepare(`SELECT stale, status, score FROM match_results WHERE id = 'match-old-1'`).get() as any
    const proposed = db.prepare(`SELECT stale FROM match_results WHERE id = 'match-old-2'`).get() as any
    expect(Number(accepted.stale), 'accepted match must not be marked stale (protected)').toBe(0)
    expect(accepted.status, 'ON CONFLICT 路径不更新 status 字段').toBe('accepted')
    expect(Number(accepted.score), 'ON CONFLICT 路径更新 score (新 fit_score 88)').toBe(88)
    expect(Number(proposed.stale), 'proposed match must be marked stale').toBe(1)
  })

  it('RES-009: product_matching → 存在 active opp stage<3 → 升级到 3 + matching_completed 事件 (1 per opp + 1 per customer)', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET stage = 2, status = 'active' WHERE id = 'opp-01'`).run()
    const activeOppCount = Number((db.prepare(`SELECT COUNT(*) c FROM opportunities WHERE customer_id = 'customer-wca-01' AND status = 'active'`).get() as any).c)
    const beforeEvents = Number((db.prepare(`SELECT COUNT(*) c FROM opportunity_events WHERE customer_id = 'customer-wca-01' AND type = 'matching_completed'`).get() as any).c)

    applyAgentResult('task-009', 'product_matching', 'customer-wca-01', matchPayload(), {})

    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-01'`).get() as any
    expect(Number(opp.stage)).toBe(3)
    expect(String(opp.next_action)).toMatch(/人工确认/)
    const afterEvents = Number((db.prepare(`SELECT COUNT(*) c FROM opportunity_events WHERE customer_id = 'customer-wca-01' AND type = 'matching_completed'`).get() as any).c)
    // 每次 product_matching 写入 N(per opp) + 1(per customer) 个事件
    expect(afterEvents).toBe(beforeEvents + activeOppCount + 1)
  })

  // ── outreach_drafting ─────────────────────────────────────────
  it('RES-010: outreach_drafting → opportunity 缺 contact_id → throws missing_contact', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET contact_id = ? WHERE id = 'opp-01'`).run('')
    expect(() => applyAgentResult('task-010', 'outreach_drafting', 'opp-01', draftPayload(), {}))
      .toThrow(/missing_contact/)
  })

  it('RES-011: outreach_drafting → contact.status 非 contactable → throws missing_contact', () => {
    const { db } = useIsolatedDb()
    const opp = db.prepare('SELECT contact_id FROM opportunities WHERE id = ?').get('opp-01') as any
    db.prepare(`UPDATE contacts SET status = 'verify' WHERE id = ?`).run(opp.contact_id)
    expect(() => applyAgentResult('task-011', 'outreach_drafting', 'opp-01', draftPayload(), {}))
      .toThrow(/missing_contact/)
  })

  it('RES-012: outreach_drafting + language=zh + stage<5 → 升级到 stage=5 + email_draft 已插', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET stage = 3, status = 'active' WHERE id = 'opp-01'`).run()

    applyAgentResult('task-012', 'outreach_drafting', 'opp-01', draftPayload({ language: 'zh' }), {})

    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-01'`).get() as any
    expect(Number(opp.stage)).toBe(5)
    expect(opp.next_action).toMatch(/人工审核并发送/)
    const draft = db.prepare(`SELECT * FROM email_drafts WHERE opportunity_id = 'opp-01' AND language = 'zh' ORDER BY version DESC LIMIT 1`).get() as any
    expect(draft, 'zh draft must be inserted').toBeTruthy()
    expect(draft.subject).toBe('建联主题')
    expect(draft.status).toBe('draft')
  })

  it('RES-013: outreach_drafting + language=en → 不升级 stage（仅写 draft）', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET stage = 3, status = 'active' WHERE id = 'opp-01'`).run()

    applyAgentResult('task-013', 'outreach_drafting', 'opp-01', draftPayload({ language: 'en', subject: 'EN subject', body: 'EN body' }), {})

    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-01'`).get() as any
    expect(Number(opp.stage), 'en draft must not bump stage').toBe(3)
    const draft = db.prepare(`SELECT * FROM email_drafts WHERE opportunity_id = 'opp-01' AND language = 'en' ORDER BY version DESC LIMIT 1`).get() as any
    expect(draft, 'en draft must be inserted').toBeTruthy()
    expect(draft.subject).toBe('EN subject')
  })

  it('RES-014: outreach_drafting → draft_ready 事件已发（含 taskId + evidence）', () => {
    const { db } = useIsolatedDb()
    applyAgentResult('task-014', 'outreach_drafting', 'opp-01', draftPayload(), {})

    const evt = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-01' AND type = 'draft_ready' ORDER BY created_at DESC LIMIT 1`).get() as any
    expect(evt).toBeTruthy()
    const data = JSON.parse(evt.data_json || '{}')
    expect(data.taskId).toBe('task-014')
  })

  // ── reply_qualification ─────────────────────────────────────
  it('RES-015: reply_qualification + intent=explicit → stage=8 + 无 blocker', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET stage = 7, status = 'active' WHERE id = 'opp-01'`).run()

    applyAgentResult('task-015', 'reply_qualification', 'opp-01', replyPayload({ intent: 'explicit' }), {})

    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-01'`).get() as any
    expect(Number(opp.stage)).toBe(8)
    expect(opp.blocker).toBe('')
    expect(opp.ai_summary).toBe('客户明确询价')
  })

  it.each([
    ['ambiguous', /意向模糊/],
    ['not_interested', /无意向/],
    ['auto_reply', /自动回复/]
  ])('RES-016: reply_qualification + intent=%s → stage=max(7,current) + blocker 匹配 %s', (intent, blockerRe) => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET stage = 6, status = 'active', blocker = '' WHERE id = 'opp-01'`).run()

    applyAgentResult('task-016', 'reply_qualification', 'opp-01', replyPayload({ intent }), {})

    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-01'`).get() as any
    expect(Number(opp.stage)).toBe(Math.max(7, 6)) // = 7
    expect(String(opp.blocker)).toMatch(blockerRe)
  })

  it('RES-017: reply_qualification + intent=ambiguous + 已有 stage=8 → 保持 8，不降级', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET stage = 8, status = 'active' WHERE id = 'opp-01'`).run()

    applyAgentResult('task-017', 'reply_qualification', 'opp-01', replyPayload({ intent: 'ambiguous' }), {})

    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-01'`).get() as any
    expect(Number(opp.stage), 'must not downgrade from 8 to 7').toBe(8)
  })

  // ── handoff_summary ─────────────────────────────────────────
  it('RES-018: handoff_summary → ai_summary 更新 + 事件含 risks/nextSteps/recommended_product', () => {
    const { db } = useIsolatedDb()
    applyAgentResult('task-018', 'handoff_summary', 'opp-01', handoffPayload(), {})

    const opp = db.prepare(`SELECT ai_summary FROM opportunities WHERE id = 'opp-01'`).get() as any
    expect(opp.ai_summary).toBe('交接摘要')

    const evt = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-01' AND type = 'handoff_summary' ORDER BY created_at DESC LIMIT 1`).get() as any
    expect(evt).toBeTruthy()
    const data = JSON.parse(evt.data_json || '{}')
    expect(data.taskId).toBe('task-018')
    expect(data.recommended_product).toEqual({ product_code: 'BY001', product_name: '美东大客户空派专线' })
    expect(data.risks).toEqual(['价格敏感'])
    expect(data.nextSteps).toEqual(['3 天内联系客户'])
  })

  it('RES-019: handoff_summary + 旧字符串 recommended_product（legacy 兼容）→ 事件原值写入（schema transform 只在 parse 阶段）', () => {
    const { db } = useIsolatedDb()
    const payload = handoffPayload({ recommended_product: '美东大客户空派专线' as any })
    applyAgentResult('task-019', 'handoff_summary', 'opp-01', payload, {})

    const evt = db.prepare(`SELECT data_json FROM opportunity_events WHERE opportunity_id = 'opp-01' AND type = 'handoff_summary' ORDER BY created_at DESC LIMIT 1`).get() as any
    const data = JSON.parse(evt.data_json || '{}')
    // 关键合同：applyResult 写入事件用的是 result.recommended_product 原值（applyResult 不再 transform），
    // schema transform 只在 callModel 里 schema.parse 阶段发生。所以事件里保留原字符串。
    expect(data.recommended_product).toBe('美东大客户空派专线')
    // 但 schema 解析路径（在 callModel 里）会把字符串归一为对象——由 handoff-legacy.test.ts 覆盖
  })
})

describe('AGENT-REGISTRY: getAgentSchemas / getAgentCustomerTypes 合同', () => {
  it('REG-001: getAgentSchemas 暴露 5 个 mode key 且每个都是 Zod schema（有 parse 方法）', () => {
    const schemas = getAgentSchemas()
    const expectedModes: AgentMode[] = ['customer_profiling', 'product_matching', 'outreach_drafting', 'reply_qualification', 'handoff_summary']
    for (const mode of expectedModes) {
      expect(schemas[mode], `${mode} must exist in schema registry`).toBeTruthy()
      expect(typeof schemas[mode].parse, `${mode} must be a Zod schema with .parse`).toBe('function')
    }
    // 不应有多余或缺失
    expect(Object.keys(schemas).sort()).toEqual([...expectedModes].sort())
  })

  it('REG-002: getAgentCustomerTypes 返回 6 个枚举且顺序与 CUSTOMER_TYPES 常量一致（不可静默改顺序）', () => {
    const types = getAgentCustomerTypes()
    expect(types).toEqual([
      'freight_forwarder_partner',
      'ecommerce_seller',
      'exporter',
      'trading_company',
      'direct_shipper',
      'unknown'
    ])
    // 与 profileSchema 的 enum 同步
    const enumValues = (getAgentSchemas().customer_profiling.shape.customer_type as any).options
    expect([...enumValues]).toEqual([...types])
  })
})
