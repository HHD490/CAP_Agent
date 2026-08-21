import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import {
  createAgentTask,
  runAgentTaskNow,
  setAgentProviderForTests
} from '../../server/utils/agent'

/**
 * server/utils/agent.ts → parseJsonResponse 间接契约。
 *
 * parseJsonResponse 是 Agent 模型原始输出（OpenAI choice.message.content）的"提取 + 容错"层。
 * 所有 Agent 模式（5 个）调用链最后都会经过它：先 `parseJsonResponse` 提取 JSON，再 `schemaByMode[mode].parse` 校验。
 *
 * 真实 LLM 行为不稳定：
 *  - 经常在 JSON 前后加解释/废话
 *  - 经常用 ```json ... ``` 包裹
 *  - 模型拒答 / 超时 → 空字符串
 *
 * 因此这个函数相当于"模型输出 → 系统数据"的第一道闸门。
 * 当前函数是 private，只能通过 setAgentProviderForTests 间接走全链路测试：
 *  - 返回字符串 → 走 parseJsonResponse
 *  - 返回其它类型 → 直接走 schema（对照组）
 *
 * ⚠️ 已知代码行为：callModel 里的判断是 `typeof raw === 'string' ? parseJsonResponse(raw) : raw`，
 *   只有字符串才走 parseJsonResponse；数组/数字/null/object 都不走。
 *   parseJsonResponse 函数体虽然有 `Array.isArray(content)` 分支，但当前 call site 不会触发。
 *   这是一个待优化的 dead branch，但属于实现选择，本测试文件锁定当前行为。
 *
 * 通过观察 task 终态（completed / failed + 错误信息）反推函数行为：
 *  - "completed" 表示 parseJsonResponse + schema 都通过
 *  - 错误含 "JSON 对象" → parseJsonResponse 抛错
 *  - 错误含 "Expected object" / "received X" → schema 抛错（说明 parseJsonResponse 未被调用）
 */

const baseProfile = {
  customer_type: 'unknown',
  summary: 'parseJsonResponse 单元测试摘要',
  likely_needs: [],
  capabilities: [],
  target_lanes: [],
  confidence: 'high',
  evidence: ['单测证据'],
  missing_information: [],
  suggested_next_action: 'noop'
}

async function runWithProvider(provider: () => unknown) {
  const { db } = useIsolatedDb()
  setAgentProviderForTests(provider)
  const customer = db.prepare(`SELECT id FROM customers WHERE source = 'wca_simulated' ORDER BY id LIMIT 1`).get() as any
  const { task } = createAgentTask('customer_profiling', 'customer', customer.id, { autoMatch: false })
  await runAgentTaskNow(task.id)
  return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
}

describe('PARSE-JSON-RESPONSE: 模型原始输出 → 业务 JSON 提取（间接契约）', () => {
  it('PJR-001: 纯 JSON 字符串（无前后缀）→ parseJsonResponse 提取成功，task completed', async () => {
    const task = await runWithProvider(() => JSON.stringify(baseProfile))
    expect(task.status).toBe('completed')
    expect(task.error).toBe('')
  })

  it('PJR-002: ```json\n{...}\n``` Markdown 包裹 → 剥外壳后提取成功', async () => {
    const wrapped = '```json\n' + JSON.stringify(baseProfile) + '\n```'
    const task = await runWithProvider(() => wrapped)
    expect(task.status).toBe('completed')
  })

  it('PJR-003: ```\n{...}\n``` 无 language 标签 → 仍按 code fence 剥离', async () => {
    const wrapped = '```\n' + JSON.stringify(baseProfile) + '\n```'
    const task = await runWithProvider(() => wrapped)
    expect(task.status).toBe('completed')
  })

  it('PJR-004: 模型前置废话（"Here is the JSON:" + JSON）→ 仍能从第一个 { 提取', async () => {
    const noisy = 'Here is the structured customer profile:\n' + JSON.stringify(baseProfile) + '\nLet me know if you need more.'
    const task = await runWithProvider(() => noisy)
    expect(task.status).toBe('completed')
  })

  it('PJR-005: 大写语言标签 ```JSON ... ``` → 大小写不敏感剥外壳（i flag）', async () => {
    const wrapped = '```JSON\n' + JSON.stringify(baseProfile) + '\n```'
    const task = await runWithProvider(() => wrapped)
    expect(task.status).toBe('completed')
  })

  it('PJR-006: content 字符串首尾 whitespace + Markdown 包裹组合 → 仍解析成功', async () => {
    const wrapped = '   \n  ```json\n  ' + JSON.stringify(baseProfile) + '\n  ```  \n   '
    const task = await runWithProvider(() => wrapped)
    expect(task.status).toBe('completed')
  })

  it('PJR-007: 直接返回对象（不走 parseJsonResponse）→ 对照组，task completed', async () => {
    // parseJsonResponse 只在 content 是 string 时才调用；这里直接返回对象，
    // 确认对照组（schema 直通）也成功，验证 PJR-001~006 测的是 parseJsonResponse 而非 schema
    const task = await runWithProvider(() => baseProfile)
    expect(task.status).toBe('completed')
  })

  it('PJR-008: 空字符串 → parseJsonResponse 抛 "JSON 对象"，task failed', async () => {
    const task = await runWithProvider(() => '')
    expect(task.status).toBe('failed')
    expect(String(task.error)).toMatch(/JSON 对象/)
  })

  it('PJR-009: 无 JSON 对象的纯文本 → 同样抛 "JSON 对象"', async () => {
    const task = await runWithProvider(() => 'I cannot help with that request.')
    expect(task.status).toBe('failed')
    expect(String(task.error)).toMatch(/JSON 对象/)
  })

  it('PJR-010: 只有 "{" 没有 "}" → lastIndexOf 越界抛 "JSON 对象"', async () => {
    const task = await runWithProvider(() => '{ "incomplete": true')
    expect(task.status).toBe('failed')
    expect(String(task.error)).toMatch(/JSON 对象/)
  })

  it('PJR-011: 只有 "}" 没有 "{" → indexOf 找不到抛 "JSON 对象"', async () => {
    const task = await runWithProvider(() => '"oops": }')
    expect(task.status).toBe('failed')
    expect(String(task.error)).toMatch(/JSON 对象/)
  })

  it('PJR-012: 数字 content → 不走 parseJsonResponse，被 schema 拒绝（"Expected object"）', async () => {
    // 已知行为：callModel 只对 string 调 parseJsonResponse；其他类型直接 schema.parse
    // 这是 callModel 当前实现的选择，测试锁定以防回归
    const task = await runWithProvider(() => 42 as any)
    expect(task.status).toBe('failed')
    expect(String(task.error)).toMatch(/Expected object/)
    expect(String(task.error)).not.toMatch(/JSON 对象/)
  })

  it('PJR-013: null content → 不走 parseJsonResponse，被 schema 拒绝（"Expected object"）', async () => {
    const task = await runWithProvider(() => null as any)
    expect(task.status).toBe('failed')
    expect(String(task.error)).toMatch(/Expected object/)
    expect(String(task.error)).not.toMatch(/JSON 对象/)
  })

  it('PJR-014: 数组 content → 不走 parseJsonResponse，被 schema 拒绝（"Expected object, received array"）', async () => {
    // 锁定 dead branch：parseJsonResponse 函数体有 Array.isArray 分支但 callModel 不会触发。
    // 如果以后 callModel 改为对数组也调 parseJsonResponse，本测试会变成"completed"或新的失败模式。
    const task = await runWithProvider(() => [] as any)
    expect(task.status).toBe('failed')
    expect(String(task.error)).toMatch(/Expected object/)
  })

  it('PJR-015: parseJsonResponse 成功但 schema 拒绝 → 错误来自 zod，task failed', async () => {
    // 故意给一个不满足 customer_profiling 必填的 JSON（缺 evidence）
    const broken = JSON.stringify({ ...baseProfile, evidence: [] })
    const task = await runWithProvider(() => broken)
    expect(task.status).toBe('failed')
    // 关键是：parseJsonResponse 已经成功了（否则会先抛 "JSON 对象"），
    // 所以这里错误是 zod 校验失败，不是 "JSON 对象"
    expect(String(task.error)).not.toMatch(/JSON 对象/)
  })

  it('PJR-016: 内部 JSON 不合法（{a: 1} 缺引号）→ JSON.parse 抛错向上冒泡', async () => {
    // 字符串里有合法的 {...}，但内容是 {a: 1}，JSON.parse 失败
    const malformed = 'prefix {"a": 1, "b": } suffix'
    const task = await runWithProvider(() => malformed)
    expect(task.status).toBe('failed')
    // 错误信息从 JSON.parse 冒泡出来，task 仍然 failed（但消息里没有"JSON 对象"关键字）
    expect(String(task.error).length).toBeGreaterThan(0)
  })
})
