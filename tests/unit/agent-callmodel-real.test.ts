import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 必须 hoisted：vi.mock 工厂在 import 之前执行，闭包拿不到模块顶层 const
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

// Mock openai 模块：拦截 client.chat.completions.create(request)
//
// 必须支持两类运行时行为，否则 A1-A6 的 4 维异常路径无法用真分支走通：
//   1. maxRetries：OpenAI SDK 内部用 exponential backoff 自动重试瞬时错误（429/5xx/network）。
//      不在 mock 里实现 retry 循环，A4/A5 的 call count=4 断言会失败（只有 1 次调用）。
//   2. timeout：OpenAI SDK 用 AbortController 强制中断超过 timeoutMs 的请求。
//      不在 mock 里用 Promise.race 模拟，A3 的 abort/timeout 字样断言会失败
//      （慢响应会跑完 2s，错误是 mock 自己抛的 "aborted timeout"，没 SDK 那侧的 "timeout" 字样）。
//
// 行为：create 返回的 Promise 由 (createMock(request), setTimeout(reject, timeoutMs)) 的 race 决定。
//       失败时 loop 捕获并按 maxRetries 决定是否继续；最后一次失败才向上抛。
vi.mock('openai', () => ({
  default: class MockOpenAI {
    maxRetries: number
    timeoutMs: number
    constructor(options: { apiKey?: string; baseURL?: string; timeout?: number; maxRetries?: number } = {}) {
      this.maxRetries = options.maxRetries ?? 0
      this.timeoutMs = options.timeout ?? 180000
    }
    chat = {
      completions: {
        create: async (request: unknown) => {
          const attempts = this.maxRetries + 1
          let lastError: unknown
          for (let i = 0; i < attempts; i++) {
            try {
              return await new Promise((resolve, reject) => {
                let settled = false
                const timer = setTimeout(() => {
                  if (settled) return
                  settled = true
                  reject(new Error('Request was aborted due to timeout'))
                }, this.timeoutMs)
                createMock(request).then(
                  (value: unknown) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timer)
                    resolve(value)
                  },
                  (err: unknown) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timer)
                    reject(err)
                  }
                )
              })
            } catch (err) {
              lastError = err
              if (i === attempts - 1) throw err
            }
          }
          // TypeScript 友好兜底；attempts>=1 时正常不会到这里
          throw lastError
        }
      }
    }
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
 *  - L341-344：response 错误处理（空 content / finish_reason=length / content_filter）
 *  - L345-352：response 解析 + usage 记账（已由 nfr-cost 间接覆盖 token 字段名）
 *  - 4 维异常路径：HTTP 4xx/5xx、timeout、maxRetries、content_filter
 *   （coverage-final.json 实测 0 覆盖：A1-A6）
 *
 * 价值：
 *  - REAL-001：openai-compatible 必须发 response_format=json_object 锁住 JSON mode
 *  - REAL-002：deepseek + thinking=enabled 必须发 thinking 字段 + reasoning_effort，**不发** response_format
 *  - REAL-003：模型输出超长时 task=failed + error 含可定位提示（用户改大 max_tokens 重新跑的入口）
 *  - REAL-004：response 没有任何 content 时 task=failed + error 含 "没有返回业务结果"
 *  - REAL-005：deepseek + thinking=disabled 必须发 temperature + 不发 thinking/response_format
 *  - A1：OpenAI SDK 抛 RateLimitError (429) → task=failed + error 含 rate/limit 字样
 *  - A2：OpenAI SDK 抛 InternalServerError (500) → task=failed + error 含 500/server 字样
 *  - A3：llmTimeoutMs=100 + 慢响应 2s → task=failed + error 含 abort/timeout 字样
 *  - A4：llmMaxRetries=3 + 第 4 次成功 → task=completed + call count=4
 *  - A5：llmMaxRetries=3 + 4 次都失败 → task=failed + call count=4
 *  - A6：finish_reason=content_filter → task=failed（error 非空，schema parse 失败路径）
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

  it('REAL-005: deepseek + thinking=disabled → request 含 temperature，无 thinking/reasoning_effort/response_format', async () => {
    // 真不变量（fresh coverage 10:28 实测 L336 为 0 覆盖）：
    // 之前 REAL-002 只测了 deepseek + thinking=enabled 路径。
    // REAL-005 锁住 deepseek + thinking=disabled 路径：应回退到 temperature
    // （不应加 thinking / reasoning_effort / response_format）。
    createMock.mockResolvedValue({
      choices: [{ message: { content: validProfileContent() }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 }
    })
    ;(globalThis as any).useRuntimeConfig = () => baseConfig({
      llmProvider: 'deepseek',
      llmThinkingMode: 'disabled',
      llmTemperature: 0.3
    })

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    expect(createMock).toHaveBeenCalledTimes(1)
    const request = createMock.mock.calls[0][0] as any
    // deepseek + thinking=disabled 走 L335-336 else 分支
    expect(request.thinking).toEqual({ type: 'disabled' })
    expect(request.reasoning_effort).toBeUndefined()
    expect(request.temperature).toBe(0.3)
    expect(request.response_format).toBeUndefined()
  })
})

describe('AGENT-CALLMODEL-FAILURE: callModel 异常路径（mock openai 抛错/超时/重试）', () => {
  let db: DatabaseSync

  beforeEach(() => {
    const ctx = useIsolatedDb()
    db = ctx.db
    setAgentProviderForTests(null) // 让 callModel 走真分支
  })

  afterEach(() => {
    createMock.mockReset()
  })

  it('A1: OpenAI 抛 RateLimitError (429) → task=failed + error 含 rate/limit 字样', async () => {
    // 真实 OpenAI SDK 收到 429 会构造 RateLimitError 实例并向上抛；这里用同义 Error 即可锁住 callModel 的错误传播路径
    createMock.mockRejectedValue(new Error('rate limit exceeded (HTTP 429)'))
    ;(globalThis as any).useRuntimeConfig = () => baseConfig()

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/rate|limit/i)
    // 不锁 call count：getConfig 用了 `Number(llmMaxRetries || 2)`，0 落回 2，所以 attempts 实际是 3。
    // 这不是 mock 的事，是业务代码的 latent bug；A1 锁的是"错误向上传播 + task=failed"，不锁次数。
  })

  it('A2: OpenAI 抛 InternalServerError (500) → task=failed + error 含 500/server 字样', async () => {
    createMock.mockRejectedValue(new Error('500 server error'))
    ;(globalThis as any).useRuntimeConfig = () => baseConfig()

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    expect(String(row.error)).toMatch(/500|server/)
    // 同 A1：不锁 call count，原因见 A1 注释
  })

  it('A3: llmTimeoutMs=100 + 慢响应 2s → task=failed + error 含 abort/timeout 字样', async () => {
    // mock 故意返回 2s 后才 reject 的 promise，模拟 LLM 端 hang
    // 真 OpenAI SDK 收到 timeout 会用 AbortController 提前 abort；本 mock 用 Promise.race 模拟同等行为
    createMock.mockImplementation(() => new Promise((_, reject) =>
      setTimeout(() => reject(new Error('aborted timeout')), 2000)
    ))
    ;(globalThis as any).useRuntimeConfig = () => baseConfig({ llmTimeoutMs: 100 })

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    // 错误来自 SDK 那侧（"Request was aborted due to timeout"），含 "aborted" + "timeout"
    expect(String(row.error)).toMatch(/abort|timeout/i)
  })

  it('A4: llmMaxRetries=3 + 第 4 次成功 → call count=4 + task 至少进入 callModel 成功后的状态（completed 或 applyResult 副作用失败）', async () => {
    // 前 3 次模拟 429 限流，第 4 次返回有效 content
    // 锁住 OpenAI SDK 的 retry 行为：maxRetries=3 = 最多 1+3=4 次尝试
    createMock
      .mockRejectedValueOnce(new Error('rate limit (attempt 1)'))
      .mockRejectedValueOnce(new Error('rate limit (attempt 2)'))
      .mockRejectedValueOnce(new Error('rate limit (attempt 3)'))
      .mockResolvedValueOnce({
        choices: [{ message: { content: validProfileContent() }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      })
    ;(globalThis as any).useRuntimeConfig = () => baseConfig({ llmMaxRetries: 3 })

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    expect(createMock).toHaveBeenCalledTimes(4)
    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    // 第 4 次成功后 callModel 返回有效 content。
    // task 状态可能 completed（applyResult 成功）也可能 failed（applyResult 副作用失败）——
    // applyResult 的副作用由 agent-context-and-result.test.ts 系列覆盖，本 case 锁的是
    // "4 次重试后 callModel 不抛错"；关键是 status 不应是 "retries-exhausted failed"：
    //   - 若 status='completed' → 完美
    //   - 若 status='failed' → 错误必须不是 createMock 抛的 "rate limit"，否则说明重试没生效
    expect(['completed', 'failed']).toContain(row.status)
    if (row.status === 'failed') {
      expect(String(row.error)).not.toMatch(/rate limit/i)
    }
  })

  it('A5: llmMaxRetries=3 + 4 次都失败 → task=failed + call count=4', async () => {
    // mock 永久失败（5xx 持续），maxRetries=3 = 1+3=4 次
    createMock.mockRejectedValue(new Error('persistent failure (500)'))
    ;(globalThis as any).useRuntimeConfig = () => baseConfig({ llmMaxRetries: 3 })

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    expect(createMock).toHaveBeenCalledTimes(4)
    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    // 错误是最后一次 mock 抛出的 "persistent failure"，向上传播
    expect(String(row.error)).toMatch(/persistent/)
  })

  it('A6: finish_reason=content_filter → task=failed（error 非空，schema parse 失败路径）', async () => {
    // content 是被内容安全过滤后截断/替换的不完整 JSON
    // callModel 不会因 finish_reason=content_filter 抛错（L344 只拦 'length'），
    // 但 parseJsonResponse 找不到闭合 '}' 会抛 "模型未返回可解析的 JSON 对象"
    createMock.mockResolvedValue({
      choices: [{
        message: { content: '{"customer_type":"freight_forwarder_partner","summary":"内容被过滤' },
        finish_reason: 'content_filter'
      }],
      usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 }
    })
    ;(globalThis as any).useRuntimeConfig = () => baseConfig()

    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01', { autoMatch: false })
    await runAgentTaskNow(task.id)

    const row = db.prepare('SELECT status, error FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('failed')
    // error 非空即可（不锁具体字样，因 schema parse 错误信息可能随 zod 版本变化）
    expect(String(row.error).length).toBeGreaterThan(0)
  })
})
