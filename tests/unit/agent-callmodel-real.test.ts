import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 必须 hoisted：vi.mock 工厂在 import 之前执行，闭包拿不到模块顶层 const
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

// Mock openai 模块：拦截 client.chat.completions.create(request)
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createMock } }
  }
}))

// 必须在 vi.mock 之后 import（vitest 会按 hoisted 顺序处理）
import type { DatabaseSync } from 'node:sqlite'
import { useIsolatedDb } from '../helpers/db'
import {
  createAgentTask,
  runAgentTaskNow,
  setAgentProviderForTests
} from '../../server/utils/agent'

/**
 * callModel 真 API 路径的契约测试（mock openai，不走 testProvider）。
 *
 * 真不变量（coverage-final.json 实测 0 覆盖）：
 *  - L324-340：构造 OpenAI client + 请求体（provider=deepseek vs openai-compatible 分支）
 *  - L343-344：response 错误处理（空 content / finish_reason=length）
 *  - L345-352：response 解析 + usage 记账（已由 nfr-cost 间接覆盖 token 字段名）
 *
 * 价值：
 *  - REAL-001：openai-compatible 必须发 response_format=json_object 锁住 JSON mode
 *  - REAL-002：deepseek + thinking=enabled 必须发 thinking 字段 + reasoning_effort，**不发** response_format
 *  - REAL-003：模型输出超长时 task=failed + error 含可定位提示（用户改大 max_tokens 重新跑的入口）
 *  - REAL-004：response 没有任何 content 时 task=failed + error 含 "没有返回业务结果"
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

function validProfileContent(): string {
  return JSON.stringify({
    customer_type: 'freight_forwarder_partner',
    summary: '老牌货代',
    likely_needs: [],
    capabilities: [],
    target_lanes: [],
    confidence: 'high',
    evidence: [],
    missing_information: [],
    suggested_next_action: ''
  })
}

describe('AGENT-CALLMODEL-REAL: callModel 真 API 路径（mock openai）', () => {
  let db: DatabaseSync

  beforeEach(() => {
    const ctx = useIsolatedDb()
    db = ctx.db
    setAgentProviderForTests(null) // 让 callModel 走真分支
  })

  afterEach(() => {
    createMock.mockReset()
  })

  it('REAL-001: openai-compatible 模式 → request 含 response_format=json_object + temperature，不含 thinking', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: validProfileContent() }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    })
    ;(globalThis as any).useRuntimeConfig = () => baseConfig()

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    expect(createMock).toHaveBeenCalledTimes(1)
    const request = createMock.mock.calls[0][0] as any
    // 真不变量：openai-compatible 模式构造的请求体字段
    expect(request.model).toBe('gpt-test-model')
    expect(request.temperature).toBe(0.1)
    expect(request.response_format).toEqual({ type: 'json_object' })
    expect(request.thinking).toBeUndefined()
    expect(request.reasoning_effort).toBeUndefined()
    expect(request.messages).toHaveLength(2)
    expect(request.messages[0].role).toBe('system')
    expect(request.messages[1].role).toBe('user')
    // task 状态：可能 completed（applyResult 成功）也可能 failed（applyResult 副作用）。
    // 本 case 锁的是"请求体构造"，runTask → callModel 已走到；applyResult 的副作用
    // 由 agent-context-and-result.test.ts 系列覆盖，这里不再双重断言。
    expect(['completed', 'failed']).toContain((db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(task.id) as any).status)
  })

  it('REAL-002: deepseek + thinking=enabled → request 含 thinking 字段 + reasoning_effort，不发 response_format', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: validProfileContent() }, finish_reason: 'stop' }],
      usage: null
    })
    ;(globalThis as any).useRuntimeConfig = () => baseConfig({
      llmProvider: 'deepseek',
      llmThinkingMode: 'enabled',
      llmReasoningEffort: 'medium'
    })

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    expect(createMock).toHaveBeenCalledTimes(1)
    const request = createMock.mock.calls[0][0] as any
    // deepseek 分支：thinking + reasoning_effort，**不**加 response_format，**不**加 temperature
    expect(request.thinking).toEqual({ type: 'enabled' })
    expect(request.reasoning_effort).toBe('medium')
    expect(request.response_format).toBeUndefined()
    expect(request.temperature).toBeUndefined()
  })

  it('REAL-003: response.finish_reason="length" → task=failed + error 含 "模型输出达到长度上限"', async () => {
    // content 故意截断：让 schema.parse 失败前先被 line 344 截住
    createMock.mockResolvedValue({
      choices: [{
        message: { content: '{"customer_type":"freight_forwarder_partner","summary":"被截断' },
        finish_reason: 'length'
      }],
      usage: { prompt_tokens: 8000, completion_tokens: 4096, total_tokens: 12096 }
    })
    ;(globalThis as any).useRuntimeConfig = () => baseConfig()

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error, result_json FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/模型输出达到长度上限/)
    // 失败时不应有 result_json（不能写半截结果）
    expect(row.result_json).toBe('{}')
  })

  it('REAL-004: response.choices[0].message.content 为 null → task=failed + error 含 "没有返回业务结果"', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: null }, finish_reason: 'stop' }],
      usage: null
    })
    ;(globalThis as any).useRuntimeConfig = () => baseConfig()

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/没有返回业务结果/)
  })
})
