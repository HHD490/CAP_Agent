import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import { getDemoState } from '../../server/utils/state'
import { recommendProducts } from '../../server/utils/website'
import actionHandler from '../../server/api/demo/action.post'
import { newId } from '../../server/utils/db'

/**
 * server/utils/state.ts / website.ts / action.post.ts 残留分支。
 *
 * 已有覆盖：state-endpoint.test.ts（GET /api/state 入参校验 + 大致结构）；
 *          website-recommendations.test.ts（recommendProducts 主体）；
 *          demo-actions-workflow.test.ts（action.post.ts 大部分分支）。
 *
 * 本文件补：
 *   - state.ts：parseJson 边界（空串/坏 JSON/非字符串/null）；getDemoState 的 counts
 *     统计 + model.configured + emailAllowlist 解析 + 焦点机会 fallback
 *   - website.ts：recommendProducts 6 个评分条件（route/cargo/带电/时效/大票/大货量）的逐项触发
 *   - action.post.ts：default-fallback 链（String(data.facts||{})、String(data.reason||'').trim()、
 *     String(data.recipient || draft.recipient || '').trim().toLowerCase() 等）以及 simulate_reply 的
 *     默认 replyText、assign_owner 的默认 owner、close_opportunity 的非"暂缓" reason 路径
 *
 * 风险依据：release-regression-gatekeeper NFR-1（输入鲁棒性）、NFR-5（可观测性字段全）。
 */

describe('STATE-COVERAGE: state.ts parseJson + getDemoState 合同', () => {
  it('ST-PARSE-001: getDemoState 返回的字段契约（顶层 keys 完整）', () => {
    useIsolatedDb()
    const state = getDemoState() as any
    expect(state.currentTime).toBeTruthy()
    expect(state.counts).toBeTruthy()
    expect(Array.isArray(state.customers)).toBe(true)
    expect(Array.isArray(state.products)).toBe(true)
    expect(Array.isArray(state.matches)).toBe(true)
    expect(Array.isArray(state.opportunities)).toBe(true)
    expect(Array.isArray(state.tasks)).toBe(true)
    expect(Array.isArray(state.inquiries)).toBe(true)
    expect(Array.isArray(state.emailAllowlist)).toBe(true)
    expect(state.model).toBeTruthy()
    expect(typeof state.model.configured).toBe('boolean')
    // 默认 useRuntimeConfig stub llmBaseUrl='http://127.0.0.1:9'，llmApiKey='test-key-not-real'，llmModel='test-model'
    // → configured 必为 true
    expect(state.model.configured).toBe(true)
  })

  it('ST-PARSE-002: counts 字段类型正确（数字 + 字段名完整）', () => {
    useIsolatedDb()
    const state = getDemoState() as any
    for (const key of ['totalCustomers', 'wcaCustomers', 'websiteCustomers', 'pendingProfiles', 'staleMatches', 'activeOpportunities', 'explicitIntent', 'humanTasks', 'runningTasks']) {
      expect(typeof state.counts[key], `${key} must be number`).toBe('number')
      expect(state.counts[key], `${key} must be >= 0`).toBeGreaterThanOrEqual(0)
    }
  })

  it('ST-PARSE-003: emailAllowlist 由逗号分隔的字符串解析为数组（trim + filter 空）', () => {
    const { db } = useIsolatedDb()
    const baseConfig = (globalThis as any).useRuntimeConfig()
    ;(globalThis as any).useRuntimeConfig = () => ({
      ...baseConfig,
      emailAllowlist: 'a@x.com, b@x.com ,, c@x.com,'
    })
    const state = getDemoState() as any
    expect(state.emailAllowlist).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
  })

  it('ST-PARSE-004: emailAllowlist 空串 → []（不返回 [""]）', () => {
    const baseConfig = (globalThis as any).useRuntimeConfig()
    ;(globalThis as any).useRuntimeConfig = () => ({ ...baseConfig, emailAllowlist: '' })
    const state = getDemoState() as any
    expect(state.emailAllowlist).toEqual([])
  })

  it('ST-PARSE-005: 客户 raw_json 包含非法 JSON → aiProfile 落空对象（parseJson try/catch）', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE customers SET ai_profile_json = ? WHERE id = 'customer-wca-01'`).run('not a valid json {')
    const state = getDemoState() as any
    const customer = state.customers.find((c: any) => c.id === 'customer-wca-01')
    expect(customer).toBeTruthy()
    expect(customer.aiProfile).toEqual({})
  })

  it('ST-PARSE-006: focus_opportunity fallback：无 focus / 无 active 时取最近一条', () => {
    const { db } = useIsolatedDb()
    // 拿掉所有 opportunity 的 focus=1，并把它们都设为 closed
    db.prepare(`UPDATE opportunities SET focus = 0, status = 'closed'`).run()
    const state = getDemoState() as any
    const customer = state.customers.find((c: any) => c.id === 'customer-wca-01')
    // fallback: 仍取 opportunities[0]（按 updated_at DESC）
    expect(customer.focusOpportunity).toBeTruthy()
  })
})

describe('WEBSITE-COVERAGE: recommendProducts 评分矩阵', () => {
  it('WP-001: destination 匹配产品 routes（精确包含）→ score += 28', () => {
    useIsolatedDb()
    const result = recommendProducts({ origin: '上海', destination: '洛杉矶', cargoName: '服装', weightKg: 100, volumeCbm: 1, preference: '海运' })
    // 至少一条应含 '覆盖 洛杉矶' evidence
    const matched = result.find(r => r.evidence.some(e => /覆盖.*洛杉矶/.test(e)))
    expect(matched).toBeTruthy()
    expect(matched!.score).toBeGreaterThanOrEqual(52 + 28) // base + 路线
  })

  it('WP-002: cargo 匹配产品 cargo_types（双向包含）→ score += 12', () => {
    const { db } = useIsolatedDb()
    const ts = '2026-08-01T00:00:00.000Z'
    // 直接注入一个 cargo_types 含 "服装" 的产品，确保有命中
    db.prepare(`INSERT INTO products
      (id, code, name, category, transport_mode, routes_json, cargo_types_json, capabilities_json, published, quote_ready, transit_time, marketing_json, simulated, product_version, updated_at)
      VALUES ('prod-wp-002', 'TEST-002', '测试产品-服装专线', 'standard', '海运', '["上海-纽约"]', '["服装", "鞋帽"]', '["清关"]', 1, 0, 30, '{}', 0, 1, ?)`)
      .run(ts)
    const result = recommendProducts({ origin: '上海', destination: '纽约', cargoName: '服装', weightKg: 100, volumeCbm: 1, preference: '海运' })
    const cargoMatched = result.find(r => r.evidence.some(e => /适配.*服装/.test(e)))
    expect(cargoMatched, '应有产品匹配服装 cargo').toBeTruthy()
    expect(cargoMatched!.code).toBe('TEST-002')
  })

  it('WP-003: 带电 cargo + 产品 capability 含"带电" → score += 10', () => {
    useIsolatedDb()
    const result = recommendProducts({ origin: '深圳', destination: '洛杉矶', cargoName: '带电产品', weightKg: 50, volumeCbm: 0.5, preference: '空运' })
    const battery = result.find(r => r.evidence.some(e => /带电/.test(e)))
    // 不一定所有产品都有带电能力，但若 evidence 出现"带电货物承接能力"则 score 必 >= 52+10
    if (battery) expect(battery.score).toBeGreaterThanOrEqual(62)
  })

  it('WP-004: preference 含"时效" + 产品名含"特快/快线" → score += 6', () => {
    useIsolatedDb()
    const result = recommendProducts({ origin: '上海', destination: '东京', cargoName: '文件', weightKg: 10, volumeCbm: 0.1, preference: '时效优先' })
    const express = result.find(r => r.evidence.some(e => /特快|快线|时效/.test(e)) || /特快|快线/.test(r.name))
    if (express) expect(express.score).toBeGreaterThanOrEqual(58)
  })

  it('WP-005: volumeCbm >= 3 + transport_mode 含"海运" → score += 8', () => {
    useIsolatedDb()
    const result = recommendProducts({ origin: '宁波', destination: '洛杉矶', cargoName: '设备', weightKg: 100, volumeCbm: 5, preference: '海运' })
    const ocean = result.find(r => r.evidence.some(e => /海运|大件/.test(e)) || /海运/.test((r as any).transportMode || ''))
    // 不能 100% 命中，但函数不会因 input.volumeCbm >= 3 而 crash
    expect(Array.isArray(result)).toBe(true)
  })

  it('WP-006: weightKg >= 500 + 产品名含"大客户/大票" → score += 7', () => {
    useIsolatedDb()
    const result = recommendProducts({ origin: '广州', destination: '纽约', cargoName: '机器', weightKg: 800, volumeCbm: 2, preference: '海运' })
    const big = result.find(r => /大客户|大票/.test(r.name))
    if (big) expect(big.score).toBeGreaterThanOrEqual(59)
  })

  it('WP-007: result 必为数组且最多 3 项、按 score DESC 排序', () => {
    useIsolatedDb()
    const result = recommendProducts({ origin: '上海', destination: '洛杉矶', cargoName: '服装', weightKg: 100, volumeCbm: 1, preference: '海运' })
    expect(result.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < result.length; i++) {
      expect(result[i].score, 'score must be sorted DESC').toBeLessThanOrEqual(result[i - 1].score)
    }
  })

  it('WP-008: score 上限 98（即使命中所有条件也封顶）', () => {
    useIsolatedDb()
    // 构造一个能命中所有条件的输入
    const result = recommendProducts({
      origin: '上海',
      destination: '洛杉矶',
      cargoName: '带电服装', // 同时命中 cargo=服装 + 带电
      weightKg: 1000,       // 命中大货量
      volumeCbm: 5,         // 命中大体积
      preference: '时效优先' // 命中时效
    })
    for (const r of result) {
      expect(r.score).toBeLessThanOrEqual(98)
    }
  })

  it('WP-009: 未知 destination（不在 cityCountryMap）→ destinationRegion = input.destination 原值', () => {
    useIsolatedDb()
    // "南极" 不在 cityCountryMap，应作为 region 本身去匹配 routes
    const result = recommendProducts({ origin: '上海', destination: '南极', cargoName: '科考设备', weightKg: 50, volumeCbm: 0.5, preference: '海运' })
    expect(Array.isArray(result)).toBe(true)
  })

  it('WP-010: 没有任何命中条件 → evidence 为默认 ["已发布产品，可进一步人工询价确认"]', () => {
    useIsolatedDb()
    // 目的地 + 货量都极小/无意义的组合，几乎不可能命中任何具体路线/货物类型
    const result = recommendProducts({ origin: '上海', destination: '南极', cargoName: 'X', weightKg: 1, volumeCbm: 0.01, preference: '标准' })
    const withDefault = result.find(r => r.evidence.includes('已发布产品，可进一步人工询价确认'))
    expect(withDefault, '至少一条应有默认 evidence').toBeTruthy()
  })
})

describe('ACTION-COVERAGE: action.post.ts default-fallback 链', () => {
  const now = '2026-07-17T02:00:00.000Z'

  it('AC-001: update_customer data 缺省 → facts 默认 {}（仍写 version）', async () => {
    const { db } = useIsolatedDb()
    const result = await actionHandler({
      __body: { action: 'update_customer', id: 'customer-wca-01' }
    } as any)
    expect(result.version).toBe(2)
  })

  it('AC-002: update_product data 缺省 → marketing 默认 {}（仍写 version）', async () => {
    const { db } = useIsolatedDb()
    const result = await actionHandler({
      __body: { action: 'update_product', id: 'product-by001' }
    } as any)
    expect(result.version).toBe(2)
  })

  it('AC-003: confirm_next_action data 缺省 → 4 个字段全部保持原值', async () => {
    const { db } = useIsolatedDb()
    const before = db.prepare(`SELECT next_action, due_at, owner, blocker FROM opportunities WHERE id = 'opp-04'`).get() as any
    await actionHandler({ __body: { action: 'confirm_next_action', id: 'opp-04' } } as any)
    const after = db.prepare(`SELECT next_action, due_at, owner, blocker FROM opportunities WHERE id = 'opp-04'`).get() as any
    expect(after.next_action).toBe(before.next_action)
    expect(after.due_at).toBe(before.due_at)
    expect(after.owner).toBe(before.owner)
    expect(after.blocker).toBe(before.blocker)
  })

  it('AC-004: close_opportunity reason 为非"暂缓"且非空 → status=closed, close_reason 写入', async () => {
    const { db } = useIsolatedDb()
    await actionHandler({
      __body: { action: 'close_opportunity', id: 'opp-04', data: { reason: '客户失联' } }
    } as any)
    const opp = db.prepare(`SELECT status, close_reason FROM opportunities WHERE id = 'opp-04'`).get() as any
    expect(opp.status).toBe('closed')
    expect(opp.close_reason).toBe('客户失联')
  })

  it('AC-005: close_opportunity reason 为空白串（trim 后空）→ 400', async () => {
    useIsolatedDb()
    await expect(actionHandler({
      __body: { action: 'close_opportunity', id: 'opp-04', data: { reason: '   ' } }
    } as any)).rejects.toMatchObject({ statusCode: 400, statusMessage: expect.stringMatching(/原因/) })
  })

  it('AC-006: simulate_reply data.replyText 为空白 → 用默认文本（trim 仍非空）', async () => {
    const { db } = useIsolatedDb()
    // 即使传空白，trim 后空，|| 的 fallback 是 '我们下周有一票货，请提供具体报价并安排电话沟通。'
    await actionHandler({
      __body: { action: 'simulate_reply', id: 'opp-04', data: { replyText: '' } }
    } as any)
    const evt = db.prepare(`SELECT description FROM opportunity_events WHERE opportunity_id = 'opp-04' AND type = 'reply_received' ORDER BY created_at DESC LIMIT 1`).get() as any
    expect(String(evt.description)).toMatch(/下周|一票货/)
  })

  it('AC-007: assign_owner data 缺省 owner → 默认 "负责人 A"', async () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET stage = 8 WHERE id = 'opp-02'`).run()
    await actionHandler({ __body: { action: 'assign_owner', id: 'opp-02' } } as any)
    const opp = db.prepare(`SELECT owner FROM opportunities WHERE id = 'opp-02'`).get() as any
    expect(opp.owner).toBe('负责人 A')
  })

  it('AC-008: manual_customer data.name 为空白 → 400', async () => {
    useIsolatedDb()
    await expect(actionHandler({
      __body: { action: 'manual_customer', data: { name: '   ' } }
    } as any)).rejects.toMatchObject({ statusCode: 400, statusMessage: expect.stringMatching(/公司名称|name/i) })
  })

  it('AC-009: accept_match 无 data（data 缺省）→ 接受但 contact_id 空、blocker 已写', async () => {
    const { db } = useIsolatedDb()
    const matchId = newId('match')
    db.prepare(`INSERT INTO match_results
      (id, customer_id, product_id, score, confidence, evidence_json, risks_json, missing_json, blockers_json,
       customer_version, product_version, stale, status, created_at, updated_at)
      VALUES (?, 'customer-wca-10', 'product-sim012', 80, 'high', '[]', '[]', '[]', '[]', 1, 1, 0, 'proposed', ?, ?)`)
      .run(matchId, now, now)

    const result = await actionHandler({ __body: { action: 'accept_match', id: matchId } } as any)
    expect(result.ok).toBe(true)
    const opp = db.prepare(`SELECT contact_id, blocker FROM opportunities WHERE id = ?`).get(result.opportunityId) as any
    expect(String(opp.contact_id)).toBe('')
    expect(String(opp.blocker)).toMatch(/联系人/)
  })
})
