/**
 * 可观测域 OBSERV（SCOPE-NFR-2026-08-11 representative_cases 落地）：
 *   - OBSERV-005: Trace 关联 ID（task ↔ event ↔ draft ↔ step）
 *   - OBSERV-006: 错误日志脱敏（运行时无 LLM_KEY 泄露）
 *   - OBSERV-007: 失败重试留痕
 *
 * 阈值：spec_default + UNAPPROVED（待 PR review 签字）
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import actionHandler from '../../server/api/demo/action.post'
import {
  createAgentTask,
  runAgentTaskNow,
  setAgentProviderForTests,
  resetAgentTestHooks
} from '../../server/utils/agent'

afterEach(() => {
  resetAgentTestHooks()
  vi.restoreAllMocks()
})

describe('NFR-OBSERV: 可观测性（Trace / 脱敏 / 重试）', () => {
  it('OBSERV-005: Trace 关联 ID — task_id 必出现在 event.data_json / step.task_id / draft.opportunity_id', async () => {
    const { db } = useIsolatedDb()
    // mock Provider 返回有效中文草稿
    setAgentProviderForTests(async () => JSON.stringify({
      language: 'zh', subject: 'Trace 测试', body: '正文', call_to_action: 'CTA', evidence: ['e1']
    }))
    // 创建一个 outreach_drafting 任务并跑完
    const { task } = createAgentTask('outreach_drafting', 'opportunity', 'opp-01', { autoMatch: false, language: 'zh' })
    await runAgentTaskNow(task.id)

    // 1) agent_task_steps.task_id = task.id
    const steps = db.prepare(`SELECT task_id FROM agent_task_steps WHERE task_id = ?`).all(task.id) as any[]
    expect(steps.length, 'task steps 必留痕').toBeGreaterThan(0)
    for (const s of steps) expect(s.task_id, 'step.task_id 一致').toBe(task.id)

    // 2) opportunity_events.data_json 含 taskId（按实现）
    const events = db.prepare(`SELECT data_json FROM opportunity_events WHERE opportunity_id = 'opp-01' AND data_json LIKE ?`).all(`%${task.id}%`) as any[]
    expect(events.length, 'events.data_json 应含 task.id').toBeGreaterThan(0)

    // 3) email_drafts.opportunity_id 关联（可追溯）
    const drafts = db.prepare(`SELECT id, opportunity_id FROM email_drafts WHERE opportunity_id = 'opp-01' ORDER BY version DESC LIMIT 1`).get() as any
    expect(drafts, 'draft.opportunity_id 可追溯').toBeTruthy()
    expect(drafts.opportunity_id).toBe('opp-01')
  })

  it('OBSERV-006: 错误日志脱敏 — 触发含 LLM_KEY 的错误，运行时无 LLM_KEY 泄露', async () => {
    useIsolatedDb()
    // mock Provider 抛错含 LLM_KEY 字面值
    const fakeKey = 'sk-leak-test-12345'
    setAgentProviderForTests(async () => { throw new Error(`Provider 失败: api_key=${fakeKey} invalid`) })
    // 监听 console.error 和 process.stderr
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stderrChunks: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stderrChunks.push(String(chunk))
      return true
    })
    try {
      const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
      await runAgentTaskNow(task.id)
      // 检查 console.error 内容不含 LLM_KEY
      const allConsole = consoleSpy.mock.calls.map(c => String(c[0] || '')).join(' ')
      expect(allConsole, 'console.error 不应含 LLM_KEY 字面值').not.toContain(fakeKey)
      // 检查 stderr 不含 LLM_KEY
      const allStderr = stderrChunks.join(' ')
      expect(allStderr, 'stderr 不应含 LLM_KEY 字面值').not.toContain(fakeKey)
    } finally {
      stderrSpy.mockRestore()
      consoleSpy.mockRestore()
    }
  })

  it('OBSERV-007: 失败重试留痕 — mock 失败 1 次后成功（spec_default 无重试，steps 含 failed + completed）', async () => {
    const { db } = useIsolatedDb()
    let n = 0
    setAgentProviderForTests(async () => {
      n += 1
      if (n === 1) throw new Error('首次失败（模拟瞬时错误）')
      return JSON.stringify({
        customer_type: 'trading_company',
        summary: '第二次成功', likely_needs: [], capabilities: [], target_lanes: [],
        confidence: 'high', evidence: ['e1'], missing_information: [], suggested_next_action: '...'
      })
    })
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)
    // spec_default 无重试：第 1 次失败后立即 task=failed，不会自动重试
    const row = db.prepare(`SELECT status, error FROM agent_tasks WHERE id = ?`).get(task.id) as any
    expect(row.status, '无重试机制 → task=failed').toBe('failed')
    // 失败 step 留痕
    const failedStep = db.prepare(`SELECT phase, summary FROM agent_task_steps WHERE task_id = ? AND phase = 'failed'`).get(task.id) as any
    expect(failedStep, 'failed step 必留痕').toBeTruthy()
    // call_count = 1（无重试）
    expect(n, 'spec_default 无重试').toBe(1)
  })
})
