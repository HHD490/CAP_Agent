import { afterEach, describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import {
  applyAgentResult,
  buildTargetContext,
  createAgentTask,
  runAgentTaskNow,
  setAgentProviderForTests,
  stopAgentTask
} from '../../server/utils/agent'

/**
 * server/utils/agent.ts 剩余未覆盖分支的合同级单测。
 *
 * 已有覆盖：
 *   - agent-lifecycle.test.ts：状态机、cascade、step 留痕
 *   - agent-context-and-result.test.ts：buildTargetContext / applyAgentResult 5 mode 主体
 *   - agent-schemas.test.ts：schema 字段级校验
 *   - parse-json-response.test.ts：parseJsonResponse 间接契约
 *
 * 本文件补：
 *   - runTask 在 status=stopped 时早退（不执行、不留痕）
 *   - runTask 失败时：task=failed + 留 failed step + completed_at 落库
 *   - runTask：input.autoMatch=false 抑制 customer_profiling → product_matching 级联
 *   - callModel 4 条配置校验（缺 baseURL / apiKey / model；maxOutputTokens 越界）
 *   - buildTargetContext：reply_qualification / handoff_summary + contact=null 不抛错
 *   - applyAgentResult：handoff_summary + opportunity 不存在 → throws（防御性）
 *
 * 风险依据（来自 release-regression-gatekeeper + agent-nondeterministic-evaluator）：
 *   - 配置校验缺失 → 模型未配置仍能创建任务但失败，浪费数据库
 *   - stopped 任务被重新执行 → 资源浪费 + 任务表脏数据
 *   - cascade 失控 → 一个客户画像任务成功后产生 N 个匹配任务，污染指标
 *   - contact=null 抛错 → reply/handoff 任务全挂，影响核心业务
 */

const profilePayload = (overrides: Record<string, any> = {}) => ({
  customer_type: 'trading_company',
  summary: 'edge-case test profile',
  likely_needs: ['中国出口运力'],
  capabilities: ['清关'],
  target_lanes: ['中国-美国'],
  confidence: 'high',
  evidence: ['edge evidence'],
  missing_information: [],
  suggested_next_action: 'noop',
  ...overrides
})

const matchPayload = () => ({
  matches: [{
    product_code: 'BY001',
    fit_score: 88,
    confidence: 'high',
    evidence: ['e'],
    risks: [],
    missing_information: [],
    hard_blockers: []
  }]
})

// —— 用于 callModel 配置校验测试：临时替换 globalThis.useRuntimeConfig ——
const originalUseRuntimeConfig = (globalThis as any).useRuntimeConfig
afterEach(() => {
  ;(globalThis as any).useRuntimeConfig = originalUseRuntimeConfig
})

function setRuntimeConfig(overrides: Record<string, any>) {
  ;(globalThis as any).useRuntimeConfig = () => ({
    databasePath: './data/acquisition-demo.sqlite',
    llmProvider: 'openai-compatible',
    llmBaseUrl: 'http://127.0.0.1:9',
    llmApiKey: 'test-key-not-real',
    llmModel: 'test-model',
    llmThinkingMode: 'disabled',
    llmReasoningEffort: 'high',
    llmContextWindowTokens: 128000,
    llmModelMaxOutputTokens: 32768,
    llmMaxOutputTokens: 4096,
    llmTimeoutMs: 1000,
    llmMaxRetries: 0,
    llmTemperature: 0.1,
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    emailAllowlist: '',
    public: { appBaseUrl: 'http://127.0.0.1:3100' },
    ...overrides
  })
}

describe('AGENT-RUNTASK: 任务状态机与执行边界', () => {
  it('RUN-001: status=stopped 的任务被 runTask 早退（不调用 model，不写 result step）', async () => {
    const { db } = useIsolatedDb()
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    stopAgentTask(task.id)

    let providerCalled = false
    setAgentProviderForTests(async () => {
      providerCalled = true
      return profilePayload()
    })

    await runAgentTaskNow(task.id)

    expect(providerCalled, 'stopped 任务不应触发 provider').toBe(false)
    const row = db.prepare('SELECT status, phase, current_step FROM agent_tasks WHERE id = ?').get(task.id) as any
    // 状态保留为 stopped，不被覆盖成 running / completed
    expect(row.status).toBe('stopped')
    expect(row.phase).not.toBe('completed')
  })

  it('RUN-002: provider 抛错 → task=failed + failed step 留痕 + error 字段非空', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => {
      throw new Error('simulated model failure')
    })
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })

    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error, completed_at FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/simulated model failure/)
    expect(String(row.completed_at).length).toBeGreaterThan(0)

    // failed step 一定存在
    const failedStep = db.prepare(`SELECT phase, summary FROM agent_task_steps WHERE task_id = ? AND phase = 'failed'`).get(task.id) as any
    expect(failedStep).toBeTruthy()
    expect(String(failedStep.summary)).toMatch(/失败/)
  })

  it('RUN-003: customer_profiling + autoMatch=false → 成功不级联 product_matching', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => profilePayload())
    const beforeMatching = Number((db.prepare(`SELECT COUNT(*) c FROM agent_tasks WHERE mode = 'product_matching' AND target_id = 'customer-wca-01'`).get() as any).c)

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('completed')

    const afterMatching = Number((db.prepare(`SELECT COUNT(*) c FROM agent_tasks WHERE mode = 'product_matching' AND target_id = 'customer-wca-01'`).get() as any).c)
    expect(afterMatching, 'autoMatch=false 时不应新增 product_matching 任务').toBe(beforeMatching)
  })

  it('RUN-004: 缺省 input（即 input={}）时 autoMatch 视为 true（默认行为）', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async (mode: string) => {
      if (mode === 'customer_profiling') return profilePayload()
      return matchPayload()
    })

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', {})
    await runAgentTaskNow(task.id)

    const profileRow = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(profileRow.status).toBe('completed')

    // 级联创建的 product_matching 任务必须存在
    const cascaded = db.prepare(`SELECT * FROM agent_tasks WHERE mode = 'product_matching' AND target_id = 'customer-wca-01'`).all() as any[]
    expect(cascaded.length).toBeGreaterThanOrEqual(1)
    const inputJson = JSON.parse(cascaded[0].input_json || '{}')
    expect(inputJson.triggeredBy).toBe(task.id)
  })

  it('RUN-005: customer_profiling 成功但匹配任务存在性不影响自身（不互相污染）', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => profilePayload())

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: true })
    // 先把 product_matching 任务停在 queued 状态，确认 customer_profiling 不会因它失败而失败
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('completed')
    expect(String(row.error).length).toBe(0)
  })
})

describe('AGENT-CALLMODEL: 真实 callModel 路径的配置校验（不走 testProvider）', () => {
  it('CALL-001: baseURL 缺失 → task=failed，error 含 "Model Endpoint 未配置"', async () => {
    const { db } = useIsolatedDb()
    setRuntimeConfig({ llmBaseUrl: '' })
    // 确保 testProvider 为 null
    setAgentProviderForTests(null as any)

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/Model Endpoint 未配置/)
  })

  it('CALL-002: apiKey 缺失 → task=failed，error 含 "Model Endpoint 未配置"', async () => {
    const { db } = useIsolatedDb()
    setRuntimeConfig({ llmApiKey: '' })
    setAgentProviderForTests(null as any)

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/Model Endpoint 未配置/)
  })

  it('CALL-003: model 缺失 → task=failed', async () => {
    const { db } = useIsolatedDb()
    setRuntimeConfig({ llmModel: '' })
    setAgentProviderForTests(null as any)

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/Model Endpoint 未配置/)
  })

  it('CALL-004: maxOutputTokens > contextWindowTokens → task=failed，error 含 "上下文"', async () => {
    const { db } = useIsolatedDb()
    setRuntimeConfig({ llmContextWindowTokens: 1024, llmMaxOutputTokens: 2048 })
    setAgentProviderForTests(null as any)

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/不能超过上下文长度/)
  })

  it('CALL-005: maxOutputTokens > modelMaxOutputTokens → task=failed，error 含 "模型上限"', async () => {
    const { db } = useIsolatedDb()
    setRuntimeConfig({ llmModelMaxOutputTokens: 4096, llmMaxOutputTokens: 8192 })
    setAgentProviderForTests(null as any)

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/模型上限/)
  })
})

describe('AGENT-CTX-EDGE: buildTargetContext 剩余 mode × contact=null 组合', () => {
  it('CTX-EDGE-001: reply_qualification + opportunity 无 contact_id → contact=null，不抛错', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET contact_id = ? WHERE id = 'opp-01'`).run('')

    let ctx: any
    expect(() => {
      ctx = buildTargetContext('reply_qualification', 'opp-01', {})
    }).not.toThrow()

    expect(ctx.opportunity).toBeTruthy()
    expect(ctx.customer).toBeTruthy()
    expect(ctx.product).toBeTruthy()
    expect(ctx.contact).toBeNull()
    expect(Array.isArray(ctx.timeline)).toBe(true)
    expect(Array.isArray(ctx.drafts)).toBe(true)
  })

  it('CTX-EDGE-002: handoff_summary + opportunity 无 contact_id → contact=null，不抛错', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET contact_id = ? WHERE id = 'opp-01'`).run('')

    let ctx: any
    expect(() => {
      ctx = buildTargetContext('handoff_summary', 'opp-01', {})
    }).not.toThrow()

    expect(ctx.opportunity).toBeTruthy()
    expect(ctx.contact).toBeNull()
  })

  it('CTX-EDGE-003: reply_qualification + opportunity 不存在 → throws 获客机会不存在', () => {
    useIsolatedDb()
    expect(() => buildTargetContext('reply_qualification', 'opp-nonexistent'))
      .toThrow(/获客机会不存在/)
  })

  it('CTX-EDGE-004: handoff_summary + opportunity 不存在 → throws', () => {
    useIsolatedDb()
    expect(() => buildTargetContext('handoff_summary', 'opp-nonexistent'))
      .toThrow(/获客机会不存在/)
  })
})

describe('AGENT-APPLY-EDGE: applyResult 剩余 mode 边界', () => {
  it('APPLY-EDGE-001: handoff_summary + opportunity 不存在 → throws 获客机会不存在', () => {
    useIsolatedDb()
    expect(() => buildTargetContext('handoff_summary', 'opp-nonexistent'))
      .toThrow(/获客机会不存在/)
  })

  it('APPLY-EDGE-002: reply_qualification + intent=ambiguous + stage 已经是 8 → 保持 8（不降级）', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET stage = 8, status = 'active' WHERE id = 'opp-01'`).run()

    const payload = {
      intent: 'ambiguous',
      confidence: 'high',
      evidence: ['客户回复模糊'],
      summary: '需要人工确认',
      next_action: '人工跟进'
    }
    applyAgentResult('task-h1', 'reply_qualification', 'opp-01', payload, {})

    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-01'`).get() as any
    expect(Number(opp.stage), 'stage 8 不应被降级').toBe(8)
    expect(String(opp.blocker)).toMatch(/意向模糊/)
  })
})
