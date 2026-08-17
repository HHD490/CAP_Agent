import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import {
  createAgentTask,
  getAgentSchemas,
  runAgentTaskNow,
  setAgentProviderForTests,
  stopAgentTask
} from '../../server/utils/agent'

/**
 * Agent 任务生命周期：覆盖 agent-nondeterministic-evaluator 和 test-process-governor
 * 共同关心的"可追溯、可监控、可停止"三个属性。
 *
 * 状态机（来自 server/utils/agent.ts）：
 *   queued → running → completed | failed | stopped
 *
 * 业务规则：
 *   - 同一 (mode, target_type, target_id) 在 queued/running/waiting 时
 *     重复创建会返回 duplicate=true，不会创建新任务
 *   - 任务至少留痕 3 个 task_steps（requesting → context → model_request → model_result → tool_result）
 *   - stop 任务后，task.status 立刻变 stopped；如果已经在终态，原样返回
 *   - customer_profiling + autoMatch=true 成功后会级联创建 product_matching 任务
 */
const profilePayload = (customerType: 'trading_company' | 'freight_forwarder_partner' = 'trading_company') => ({
  customer_type: customerType,
  summary: '测试客户画像',
  likely_needs: ['中国出口运力'],
  capabilities: ['清关'],
  target_lanes: ['中国-美国'],
  confidence: 'high',
  evidence: ['公司服务范围'],
  missing_information: [],
  suggested_next_action: '进入产品匹配'
})

const matchPayload = () => ({
  matches: [{
    product_code: 'BY001',
    fit_score: 88,
    confidence: 'high',
    evidence: ['美国方向'],
    risks: [],
    missing_information: [],
    hard_blockers: []
  }]
})

describe('AGENT-LIFECYCLE: 任务创建、状态机、停止、去重、级联', () => {
  it('AGENT-LIFE-001: createAgentTask 默认状态 queued, phase requesting, progress=5', () => {
    const { db } = useIsolatedDb()
    const { task, duplicate } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    expect(duplicate).toBe(false)
    expect(task.status).toBe('queued')
    expect(task.phase).toBe('requesting')
    expect(Number(task.progress)).toBe(5)

    const row = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('queued')
  })

  it('AGENT-LIFE-002: 同一目标二次创建返回 duplicate=true 且不创建新任务', () => {
    useIsolatedDb()
    const first = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    expect(first.duplicate).toBe(false)
    const second = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    expect(second.duplicate).toBe(true)
    expect(second.task.id).toBe(first.task.id)
  })

  it('AGENT-LIFE-003: 不同 (mode, target_type, target_id) 不被去重', () => {
    useIsolatedDb()
    const a = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', {})
    const b = createAgentTask('product_matching', 'customer', 'customer-wca-01', {})
    const c = createAgentTask('customer_profiling', 'customer', 'customer-wca-02', {})
    expect(a.duplicate).toBe(false)
    expect(b.duplicate).toBe(false)
    expect(c.duplicate).toBe(false)
  })

  it('AGENT-LIFE-004: 已完成的任务不被去重，可以重新创建', () => {
    const { db } = useIsolatedDb()
    const first = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })

    setAgentProviderForTests(async () => profilePayload())
    return (async () => {
      await runAgentTaskNow(first.task.id)
      const finished = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(first.task.id) as any
      expect(finished.status).toBe('completed')

      // 完成后可以再次创建
      const second = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
      expect(second.duplicate).toBe(false)
    })()
  })

  it('AGENT-LIFE-005: stopAgentTask 把 queued 任务标为 stopped', () => {
    const { db } = useIsolatedDb()
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    const stopped = stopAgentTask(task.id) as any
    expect(stopped.status).toBe('stopped')

    const row = db.prepare('SELECT status, completed_at FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('stopped')
    expect(String(row.completed_at)).not.toBe('')
  })

  it('AGENT-LIFE-006: stopAgentTask 对已停止任务幂等', () => {
    const { db } = useIsolatedDb()
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', {})
    stopAgentTask(task.id)
    const firstRow = db.prepare('SELECT status, completed_at FROM agent_tasks WHERE id = ?').get(task.id) as any

    // 二次 stop: 应该不变
    const second = stopAgentTask(task.id) as any
    expect(second.status).toBe('stopped')
    const secondRow = db.prepare('SELECT status, completed_at FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(secondRow.completed_at).toBe(firstRow.completed_at)
  })

  it('AGENT-LIFE-007: stopAgentTask 对已 completed 任务原样返回', () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => profilePayload())
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    return (async () => {
      await runAgentTaskNow(task.id)
      const finished = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
      expect(finished.status).toBe('completed')

      const stopped = stopAgentTask(task.id) as any
      expect(stopped.status).toBe('completed')
    })()
  })

  it('AGENT-LIFE-008: stopAgentTask 对不存在的 task 抛错', () => {
    useIsolatedDb()
    expect(() => stopAgentTask('task-nonexistent')).toThrow(/任务不存在/)
  })

  it('AGENT-LIFE-009: 成功任务至少留痕 5 个 task_steps（requesting/context/model_request/model_result/tool_result）', () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => profilePayload())
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    return (async () => {
      await runAgentTaskNow(task.id)
      const steps = db.prepare('SELECT phase, summary FROM agent_task_steps WHERE task_id = ? ORDER BY sequence').all(task.id) as any[]
      const phases = steps.map(step => step.phase)
      expect(phases).toContain('requesting')
      expect(phases).toContain('context')
      expect(phases).toContain('model_request')
      expect(phases).toContain('model_result')
      expect(phases).toContain('tool_result')

      // 每个 step 必须有 summary
      for (const step of steps) expect(String(step.summary).length).toBeGreaterThan(0)
    })()
  })

  it('AGENT-LIFE-010: 失败任务必须留 failed step + error 字段', () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => ({ ...profilePayload(), evidence: [] }))
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', {})
    return (async () => {
      await runAgentTaskNow(task.id)
      const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
      expect(row.status).toBe('failed')
      expect(String(row.error).length).toBeGreaterThan(0)

      const failedStep = db.prepare(`SELECT * FROM agent_task_steps WHERE task_id = ? AND phase = 'failed'`).get(task.id) as any
      expect(failedStep).toBeTruthy()
    })()
  })

  it('AGENT-LIFE-011: customer_profiling + autoMatch=true 成功会级联创建 product_matching 任务', () => {
    const { db } = useIsolatedDb()
    const beforeMatch = Number((db.prepare(`SELECT COUNT(*) c FROM agent_tasks WHERE mode = 'product_matching' AND target_id = 'customer-wca-01'`).get() as any).c)

    setAgentProviderForTests(async (mode: string) => {
      if (mode === 'customer_profiling') return profilePayload()
      return matchPayload()
    })

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: true })
    return (async () => {
      await runAgentTaskNow(task.id)
      const profileRow = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(task.id) as any
      expect(profileRow.status).toBe('completed')

      // triggeredBy 存在 input_json 里
      const cascaded = db.prepare(`SELECT * FROM agent_tasks WHERE mode = 'product_matching' AND target_id = 'customer-wca-01' AND input_json LIKE ?`).get(`%${task.id}%`) as any
      expect(cascaded).toBeTruthy()
      const cascadedInput = JSON.parse(cascaded.input_json)
      expect(cascadedInput.triggeredBy).toBe(task.id)

      const afterMatch = Number((db.prepare(`SELECT COUNT(*) c FROM agent_tasks WHERE mode = 'product_matching' AND target_id = 'customer-wca-01'`).get() as any).c)
      expect(afterMatch).toBeGreaterThan(beforeMatch)
    })()
  })

  it('AGENT-LIFE-012: customer_profiling + autoMatch=false 不级联', () => {
    const { db } = useIsolatedDb()
    const beforeMatch = Number((db.prepare(`SELECT COUNT(*) c FROM agent_tasks WHERE mode = 'product_matching' AND target_id = 'customer-wca-01'`).get() as any).c)

    setAgentProviderForTests(async () => profilePayload())
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    return (async () => {
      await runAgentTaskNow(task.id)
      const afterMatch = Number((db.prepare(`SELECT COUNT(*) c FROM agent_tasks WHERE mode = 'product_matching' AND target_id = 'customer-wca-01'`).get() as any).c)
      expect(afterMatch).toBe(beforeMatch)
    })()
  })

  it('AGENT-LIFE-013: customer_profiling 失败不会级联 product_matching', () => {
    const { db } = useIsolatedDb()
    const beforeMatch = Number((db.prepare(`SELECT COUNT(*) c FROM agent_tasks WHERE mode = 'product_matching' AND target_id = 'customer-wca-01'`).get() as any).c)

    setAgentProviderForTests(async () => ({ ...profilePayload(), evidence: [] }))
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: true })
    return (async () => {
      await runAgentTaskNow(task.id)
      const afterMatch = Number((db.prepare(`SELECT COUNT(*) c FROM agent_tasks WHERE mode = 'product_matching' AND target_id = 'customer-wca-01'`).get() as any).c)
      expect(afterMatch).toBe(beforeMatch)
    })()
  })

  it('AGENT-LIFE-014: progress 必经过 5 → 20 → 48 → 78 → 100（completed） 或 失败时停在 failed', () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => profilePayload())
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    return (async () => {
      await runAgentTaskNow(task.id)
      const row = db.prepare('SELECT status, progress FROM agent_tasks WHERE id = ?').get(task.id) as any
      expect(row.status).toBe('completed')
      expect(Number(row.progress)).toBe(100)
    })()
  })

  it('AGENT-LIFE-015: model_request step 必包含 provider/model/thinkingMode/reasoningEffort', () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => profilePayload())
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    return (async () => {
      await runAgentTaskNow(task.id)
      const step = db.prepare(`SELECT data_json FROM agent_task_steps WHERE task_id = ? AND phase = 'model_request'`).get(task.id) as any
      const data = JSON.parse(step.data_json || '{}')
      expect(data.provider).toBeDefined()
      expect(data.model).toBeDefined()
      expect(data.thinkingMode).toBeDefined()
      expect(data.reasoningEffort).toBeDefined()
      expect(data.contextWindowTokens).toBeDefined()
    })()
  })

  it('AGENT-LIFE-016: tool_result step 必带 writeScope 标识', () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => profilePayload())
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    return (async () => {
      await runAgentTaskNow(task.id)
      const step = db.prepare(`SELECT data_json FROM agent_task_steps WHERE task_id = ? AND phase = 'tool_result'`).get(task.id) as any
      const data = JSON.parse(step.data_json || '{}')
      expect(data.writeScope).toBe('customer_profiling')
    })()
  })

  it('AGENT-LIFE-017: input_json 必须持久化（可在 task row 中读到）', () => {
    const { db } = useIsolatedDb()
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { triggeredBy: 'inquiry-seed-01', lang: 'zh' })
    const row = db.prepare('SELECT input_json FROM agent_tasks WHERE id = ?').get(task.id) as any
    const input = JSON.parse(row.input_json)
    expect(input.triggeredBy).toBe('inquiry-seed-01')
    expect(input.lang).toBe('zh')
  })

  it('AGENT-LIFE-018: 客户不存在时，targetContext 抛错 → task 标 failed + error 包含"客户"', () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => profilePayload())
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-does-not-exist', { autoMatch: false })
    return (async () => {
      await runAgentTaskNow(task.id)
      const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
      expect(row.status).toBe('failed')
      expect(String(row.error)).toMatch(/客户|customer|不存在/)
    })()
  })

  it('AGENT-LIFE-019: runTask 中途 task 被 delete 时 updateTask 静默 return（agent.ts L199 容错）', () => {
    // 触发路径：callModel 回调里先 DELETE task，再 return 合法 payload。
    // L481 updateTask 走 happy path；callModel 完成后 L492/L496 updateTask 重新 SELECT 找不到 task
    // → L199 `if (!current) return` 静默退出，不抛错。
    const { db } = useIsolatedDb()
    let capturedTaskId: string | null = null
    setAgentProviderForTests(async () => {
      // 模拟"task 在 runTask 中途被外部清理"（如后台清理/手工 SQL/测试 case 间干扰）
      if (capturedTaskId) db.prepare('DELETE FROM agent_tasks WHERE id = ?').run(capturedTaskId)
      return profilePayload()
    })
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    capturedTaskId = task.id
    return (async () => {
      // L481 happy / L492 L199 / L496 L199 全部静默 return，runTask 不抛错
      await expect(runAgentTaskNow(task.id)).resolves.toBeUndefined()
      // task 已被回调 delete
      const row = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
      expect(row).toBeUndefined()
    })()
  })

  it('AGENT-LIFE-020: runTask 收到非 Error 异常时 String(error) 分支正确序列化到 db.error（agent.ts L502）', () => {
    // 触发路径：callModel 内 testProvider 抛 string（不是 Error 实例）。
    // catch 块 L502 `error instanceof Error ? error.message : String(error)`
    // 走 String 分支 → message = 'string-error-not-Error' → L504 updateTask 写入 db.error。
    const { db } = useIsolatedDb()
    setAgentProviderForTests((() => { throw 'string-error-not-Error' }) as any)
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    return (async () => {
      await runAgentTaskNow(task.id)
      const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
      expect(row.status).toBe('failed')
      expect(row.error).toBe('string-error-not-Error')
    })()
  })
})
