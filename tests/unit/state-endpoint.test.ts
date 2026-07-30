import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import stateHandler from '../../server/api/state.get'
import { getDemoState } from '../../server/utils/state'
import { newId } from '../../server/utils/db'

/**
 * /api/state 端点 + getDemoState() 工具函数的契约测试。
 *
 * 这是整个 Demo 数据的"事实表"：运营后台所有页面都从这里拉数据。
 * 重点覆盖：
 *  - counts 统计正确（按 source/状态/阶段）
 *  - emailAllowlist 从 config.emailAllowlist 解析（trim + 过滤空）
 *  - model.* 字段从 useRuntimeConfig() 读出
 *  - focus opportunity 选择规则（focus 标记 → active 高阶段 → 任意）
 *  - opportunities 全部展开 contact / product / events / drafts
 *  - matches 携带 customer 和 product 引用
 *  - tasks 最多 80 条，按 created_at DESC
 *  - inquiries 全部带 recommendations
 */
describe('STATE-ENDPOINT: /api/state.get', () => {
  it('STATE-001: 返回 DemoState shape, currentTime 来自 demo_state', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    expect(state.currentTime).toBe('2026-07-17T02:00:00.000Z')
    expect(state.counts).toBeDefined()
    expect(Array.isArray(state.customers)).toBe(true)
    expect(Array.isArray(state.products)).toBe(true)
    expect(Array.isArray(state.matches)).toBe(true)
    expect(Array.isArray(state.opportunities)).toBe(true)
    expect(Array.isArray(state.tasks)).toBe(true)
    expect(Array.isArray(state.inquiries)).toBe(true)
    expect(state.model).toBeDefined()
  })

  it('STATE-002: counts.totalCustomers 包含 wca + website + manual + import', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    expect(state.counts.totalCustomers).toBe(33) // 30 wca + 3 website
    expect(state.counts.wcaCustomers).toBe(30)
    expect(state.counts.websiteCustomers).toBe(3)
  })

  it('STATE-003: counts.pendingProfiles 反映 ai_profile_status="pending" 的客户数', async () => {
    const { db } = useIsolatedDb()
    // 种子里有 30 个 wca，22 个 suggested，8 个 pending；3 website 全 suggested
    const state = await stateHandler({} as any) as any
    expect(state.counts.pendingProfiles).toBe(8)
    expect(state.counts.pendingProfiles).toBeLessThan(state.counts.totalCustomers)

    // 把一个 suggested 改为 pending
    db.prepare(`UPDATE customers SET ai_profile_status = 'pending' WHERE id = 'customer-wca-01'`).run()
    const after = await stateHandler({} as any) as any
    expect(after.counts.pendingProfiles).toBe(9)
  })

  it('STATE-004: counts.staleMatches 反映 match_results.stale=1 的数量', async () => {
    const { db } = useIsolatedDb()
    const state = await stateHandler({} as any) as any
    expect(state.counts.staleMatches).toBe(1) // match-05 seed 是 stale

    db.prepare(`UPDATE match_results SET stale = 1 WHERE id = 'match-02'`).run()
    const after = await stateHandler({} as any) as any
    expect(after.counts.staleMatches).toBe(2)
  })

  it('STATE-005: counts.activeOpportunities 只数 status=active', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    // 种子: opp-01 handed_off, 其余 5 个 active
    expect(state.counts.activeOpportunities).toBe(5)
  })

  it('STATE-006: counts.explicitIntent 只数 stage=8 + status=active', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    // 种子: opp-02 stage=8 active
    expect(state.counts.explicitIntent).toBe(1)
  })

  it('STATE-007: counts.humanTasks 包含 blocker 或 stage 5/8 或 due_at<=now', async () => {
    const { db } = useIsolatedDb()
    // 种子 opp-06: blocker="缺少联系人" → humanTasks
    // 种子 opp-05: stage=5 → humanTasks
    // 种子 opp-02: stage=8 → humanTasks
    // demo_state current_time = 2026-07-17T02:00:00.000Z
    // opp-04 due_at=2026-07-20T02:00:00.000Z (未来)
    // opp-03 due_at=2026-07-17T06:00:00.000Z (未来，差 4h)
    const state = await stateHandler({} as any) as any
    expect(state.counts.humanTasks).toBeGreaterThanOrEqual(3)
  })

  it('STATE-008: counts.runningTasks 包含 queued/running/waiting', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    // 种子 3 个 task 全 completed
    expect(state.counts.runningTasks).toBe(0)

    // 手动加一个 queued
    const { db } = useIsolatedDb()
    db.prepare(`INSERT INTO agent_tasks
      (id, mode, target_type, target_id, status, phase, progress, current_step, model, input_json, result_json, created_at, started_at, completed_at)
      VALUES ('task-running', 'customer_profiling', 'customer', 'customer-wca-01', 'queued', 'requesting', 0, '', 'test-model', '{}', '{}', '2026-07-17T02:00:00.000Z', '', '')`).run()
    const after = await stateHandler({} as any) as any
    expect(after.counts.runningTasks).toBe(1)
  })

  it('STATE-009: emailAllowlist 从 config 解析，trim + 过滤空', async () => {
    useIsolatedDb()
    ;(globalThis as any).useRuntimeConfig = () => ({
      ...useIsolatedDb as any,
      emailAllowlist: 'a@x.com, b@x.com, , c@x.com'
    })
    const state = await stateHandler({} as any) as any
    expect(state.emailAllowlist).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
  })

  it('STATE-010: model 字段从 useRuntimeConfig() 读出 + 正确 fallback', async () => {
    useIsolatedDb()
    ;(globalThis as any).useRuntimeConfig = () => ({
      ...useIsolatedDb as any,
      llmProvider: '',
      llmBaseUrl: '',
      llmApiKey: '',
      llmModel: '',
      llmThinkingMode: '',
      llmReasoningEffort: '',
      llmContextWindowTokens: 0,
      llmModelMaxOutputTokens: 0,
      llmMaxOutputTokens: 0
    })
    const state = await stateHandler({} as any) as any
    expect(state.model.configured).toBe(false)
    expect(state.model.provider).toBe('openai-compatible')
    expect(state.model.name).toBe('未配置')
    expect(state.model.thinkingMode).toBe('disabled')
    expect(state.model.reasoningEffort).toBe('high')
    expect(state.model.contextWindowTokens).toBe(128000)
    expect(state.model.modelMaxOutputTokens).toBe(32768)
    expect(state.model.maxOutputTokens).toBe(65536)
  })

  it('STATE-011: model.configured=true 当 baseURL+apiKey+model 都非空', async () => {
    useIsolatedDb()
    ;(globalThis as any).useRuntimeConfig = () => ({
      ...useIsolatedDb as any,
      llmBaseUrl: 'https://api.example.com',
      llmApiKey: 'sk-test',
      llmModel: 'test-model'
    })
    const state = await stateHandler({} as any) as any
    expect(state.model.configured).toBe(true)
  })

  it('STATE-012: customers 按 last_activity_at DESC 排序', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    for (let i = 1; i < state.customers.length; i++) {
      const prev = state.customers[i - 1].lastActivityAt
      const cur = state.customers[i].lastActivityAt
      expect(prev >= cur).toBe(true)
    }
  })

  it('STATE-013: customer.focusOpportunity 选择规则：focus=1 > active 高阶段 > 任意', async () => {
    const { db } = useIsolatedDb()
    // 客户 web-01 有 opp-03 (passive, stage 7, focus=1)
    const state = await stateHandler({} as any) as any
    const web01 = state.customers.find((c: any) => c.id === 'customer-web-01')
    expect(web01.focusOpportunity.id).toBe('opp-03')

    // 清掉 focus，应该回退到最高 stage
    db.prepare(`UPDATE opportunities SET focus = 0 WHERE id = 'opp-03'`).run()
    const state2 = await stateHandler({} as any) as any
    const web01b = state2.customers.find((c: any) => c.id === 'customer-web-01')
    expect(web01b.focusOpportunity.id).toBe('opp-03') // 唯一 active
  })

  it('STATE-014: opportunity 展开 contact / product / events / drafts', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    const opp02 = state.opportunities.find((o: any) => o.id === 'opp-02')
    expect(opp02.contact).toBeDefined()
    expect(opp02.product).toBeDefined()
    expect(Array.isArray(opp02.events)).toBe(true)
    expect(Array.isArray(opp02.drafts)).toBe(true)
    expect(opp02.events.length).toBeGreaterThan(0)
  })

  it('STATE-015: matches 携带 customer 和 product 引用（嵌套对象）', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    for (const match of state.matches) {
      expect(match.customer).toBeDefined()
      expect(match.product).toBeDefined()
    }
  })

  it('STATE-016: matches 按 stale DESC, score DESC, updated_at DESC', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    for (let i = 1; i < state.matches.length; i++) {
      const prev = state.matches[i - 1]
      const cur = state.matches[i]
      // stale 大的在前；stale 相同比 score 大的在前
      if (prev.stale === cur.stale) {
        expect(prev.score >= cur.score).toBe(true)
      } else {
        expect(prev.stale >= cur.stale).toBe(true)
      }
    }
  })

  it('STATE-017: tasks 限制最多 80 条，按 created_at DESC', async () => {
    const { db } = useIsolatedDb()
    // 插 100 条历史 task
    const stmt = db.prepare(`INSERT INTO agent_tasks
      (id, mode, target_type, target_id, status, phase, progress, current_step, model, input_json, result_json, created_at, started_at, completed_at)
      VALUES (?, 'customer_profiling', 'customer', 'customer-wca-01', 'completed', 'completed', 100, '', 'm', '{}', '{}', ?, ?, ?)`)
    for (let i = 0; i < 100; i++) {
      const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i * 1000)).toISOString()
      stmt.run(`task-bulk-${i}`, ts, ts, ts)
    }
    const state = await stateHandler({} as any) as any
    expect(state.tasks.length).toBe(80)
    // 最新在前
    for (let i = 1; i < state.tasks.length; i++) {
      expect(state.tasks[i - 1].createdAt >= state.tasks[i].createdAt).toBe(true)
    }
  })

  it('STATE-018: tasks 携带完整 steps（agent_task_steps）', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    for (const task of state.tasks) {
      expect(Array.isArray(task.steps)).toBe(true)
      for (let i = 1; i < task.steps.length; i++) {
        expect(task.steps[i - 1].sequence <= task.steps[i].sequence).toBe(true)
      }
    }
  })

  it('STATE-019: inquiries 包含 recommendations 数组', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    for (const inq of state.inquiries) {
      expect(Array.isArray(inq.recommendations)).toBe(true)
    }
    const seed01 = state.inquiries.find((i: any) => i.id === 'inquiry-seed-01')
    expect(seed01.recommendations.length).toBeGreaterThan(0)
  })

  it('STATE-020: products 按 simulated ASC, code ASC 排序（真实产品优先）', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    for (let i = 1; i < state.products.length; i++) {
      const prev = state.products[i - 1]
      const cur = state.products[i]
      if (prev.simulated === cur.simulated) {
        expect(prev.code <= cur.code).toBe(true)
      } else {
        expect(prev.simulated === false).toBe(true)
        expect(cur.simulated === true).toBe(true)
      }
    }
  })

  it('STATE-021: opportunity.contactId 为空时 contact 字段是 undefined（不是 null）', async () => {
    useIsolatedDb()
    const state = await stateHandler({} as any) as any
    const opp06 = state.opportunities.find((o: any) => o.id === 'opp-06')
    expect(opp06.contactId).toBe('')
    expect(opp06.contact).toBeUndefined()
  })

  it('STATE-022: getDemoState() 工具函数与 state 端点返回相同结构', () => {
    useIsolatedDb()
    const state = getDemoState() as any
    expect(state.currentTime).toBe('2026-07-17T02:00:00.000Z')
    expect(state.counts.totalCustomers).toBe(33)
  })
})
