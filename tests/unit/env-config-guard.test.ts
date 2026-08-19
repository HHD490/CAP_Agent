import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock openai（与 agent-callmodel-real.test.ts 一致）：
// callModel 守卫在 L321 已 throw，理论上不会触发 OpenAI client。
// 但保持 mock 一致性，避免未来若守卫位置前移时不至于意外打网络。
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } }
  }
}))

import type { DatabaseSync } from 'node:sqlite'
import { useIsolatedDb } from '../helpers/db'
import {
  createAgentTask,
  runAgentTaskNow,
  setAgentProviderForTests
} from '../../server/utils/agent'

/**
 * ENV 变量缺失真不变量 case（coverage-final.json 实测 0 覆盖）。
 *
 * 真不变量（server/utils/agent.ts L321-323 callModel 守卫）：
 *   L321:  !baseURL || !apiKey || !model  → throw 'Model Endpoint 未配置...'
 *   L322:  maxOutputTokens > contextWindowTokens → throw '模型最大输出长度不能超过上下文长度'
 *   L323:  maxOutputTokens > modelMaxOutputTokens → throw 'LLM_MAX_OUTPUT_TOKENS 不能超过...'
 *
 * 行为（runTask L501-505）：
 *   - callModel 抛错被 catch，**不会**从 runAgentTaskNow 重新抛出
 *   - 错误被写入 agent_tasks.error
 *   - task.status → 'failed'，completed_at 被设置
 *
 * 价值（用户 2026-08-19 评审指认的 G1 缺口）：
 *   - 启动时静默失败 vs 显式报错：本 case 锁住"显式报错 → DB 可见"路径
 *   - 任何 1 个 env 字段缺失 → 任务立刻 failed，不会 hung 在 queued
 *   - 错误文案含 "Model Endpoint" 便于运维定位
 *
 * 覆盖（3 it × 3 字段）：
 *   G1-1: llmApiKey 缺失  → 守卫命中 → agent_tasks.error LIKE '%Model Endpoint%'
 *   G1-2: llmBaseUrl 缺失 → 守卫命中 → 同上
 *   G1-3: llmModel 缺失   → 守卫命中 → 同上
 *
 * 注意：SMTP 缺失时 send_email 失败由 demo-actions-workflow.test.ts 部分覆盖，
 *       DATABASE_URL 缺失由 server/utils/db.ts 启动检查覆盖（不是 Agent 任务范畴），
 *       故这 2 个缺口不在本文件范围内。
 */

function baseConfig(overrides: Record<string, any> = {}) {
  return {
    databasePath: './data/test.sqlite',
    llmProvider: 'openai-compatible',
    llmBaseUrl: 'http://127.0.0.1:9',
    llmApiKey: 'test-key-not-real',
    llmModel: 'gpt-test-model',
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
  }
}

describe('AGENT-ENV-GUARD: callModel 守卫（env 字段缺失 → task=failed + 显式错误）', () => {
  let db: DatabaseSync

  beforeEach(() => {
    const ctx = useIsolatedDb()
    db = ctx.db
    setAgentProviderForTests(null) // 让 callModel 走真分支（L321 守卫才能命中）
  })

  afterEach(() => {
    createMock.mockReset()
  })

  it('G1-1: llmApiKey 缺失（空字符串）→ callModel 在 L321 抛 "Model Endpoint 未配置" → task=failed + error 含 "Model Endpoint"', async () => {
    ;(globalThis as any).useRuntimeConfig = () => baseConfig({ llmApiKey: '' })

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    // 注意：runAgentTaskNow 内部 catch 了 callModel 的 throw（runTask L501-505），
    // 所以这里 await 不会 re-throw。错误落到 agent_tasks.error。
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error, result_json, completed_at FROM agent_tasks WHERE id = ?').get(task.id) as any
    // 显式报错：DB 可见的失败状态
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/Model Endpoint/)
    // 失败时不应有 result_json
    expect(row.result_json).toBe('{}')
    // completed_at 必须被设置（runTask L504 patch.completed=true）
    expect(row.completed_at).toBeTruthy()
    // OpenAI client 没被构造（守卫先 throw）
    expect(createMock).not.toHaveBeenCalled()
  })

  it('G1-2: llmBaseUrl 缺失（空字符串）→ 同 G1-1 守卫路径', async () => {
    ;(globalThis as any).useRuntimeConfig = () => baseConfig({ llmBaseUrl: '' })

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error, result_json FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/Model Endpoint/)
    expect(row.result_json).toBe('{}')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('G1-3: llmModel 缺失（空字符串）→ 同 G1-1 守卫路径', async () => {
    ;(globalThis as any).useRuntimeConfig = () => baseConfig({ llmModel: '' })

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error, result_json FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/Model Endpoint/)
    expect(row.result_json).toBe('{}')
    expect(createMock).not.toHaveBeenCalled()
  })
})
