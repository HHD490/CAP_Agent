import OpenAI from 'openai'
import { z } from 'zod'
import { getDb, demoNow, addEvent, newId, markNonAcceptedMatchesStale } from './db'
import { isValidOutreachContact } from './contact'
import type { AgentMode } from '../../shared/types'

interface RuntimeAgentConfig {
  provider: string
  baseURL: string
  apiKey: string
  model: string
  thinkingMode: string
  reasoningEffort: string
  contextWindowTokens: number
  modelMaxOutputTokens: number
  maxOutputTokens: number
  timeout: number
  maxRetries: number
  temperature: number
}

const CUSTOMER_TYPES = [
  'freight_forwarder_partner',
  'ecommerce_seller',
  'exporter',
  'trading_company',
  'direct_shipper',
  'unknown'
] as const

export type AgentCustomerType = typeof CUSTOMER_TYPES[number]

export function getAgentCustomerTypes() {
  return CUSTOMER_TYPES
}

const confidenceSchema = z.preprocess((value) => {
  if (typeof value === 'number') return value >= 0.8 ? 'high' : value >= 0.55 ? 'medium' : 'low'
  const text = String(value || '').toLowerCase()
  if (['高', '高置信度', 'high'].includes(text)) return 'high'
  if (['中', '中等', 'medium'].includes(text)) return 'medium'
  if (['低', '低置信度', 'low'].includes(text)) return 'low'
  return value
}, z.enum(['low', 'medium', 'high']))

const profileSchema = z.object({
  customer_type: z.enum(CUSTOMER_TYPES),
  summary: z.string(),
  likely_needs: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  target_lanes: z.array(z.string()).default([]),
  confidence: confidenceSchema,
  evidence: z.array(z.string()).min(1),
  missing_information: z.array(z.string()).default([]),
  suggested_next_action: z.string()
})

const matchSchema = z.object({
  matches: z.array(z.object({
    product_code: z.string(),
    fit_score: z.coerce.number().min(0).max(100),
    confidence: confidenceSchema,
    evidence: z.array(z.string()).min(1),
    risks: z.array(z.string()).default([]),
    missing_information: z.array(z.string()).default([]),
    hard_blockers: z.array(z.string()).default([])
  })).min(1).max(3)
})

const draftSchema = z.object({
  language: z.preprocess(value => ['en', 'english', '英文'].includes(String(value || '').toLowerCase()) ? 'en' : 'zh', z.enum(['zh', 'en'])).default('zh'),
  subject: z.string(),
  body: z.string(),
  evidence: z.array(z.string()).min(1),
  call_to_action: z.string()
})

const replySchema = z.object({
  intent: z.enum(['explicit', 'ambiguous', 'not_interested', 'auto_reply']),
  confidence: confidenceSchema,
  evidence: z.array(z.string()).min(1),
  summary: z.string(),
  next_action: z.string()
})

const recommendedProductSchema = z.union([
  z.object({
    product_code: z.string().min(1),
    product_name: z.string().min(1)
  }),
  z.string().min(1)
]).transform((value) => {
  if (typeof value === 'string') {
    return {
      product_code: null as string | null,
      product_name: value,
      source: 'legacy_string' as const
    }
  }
  return {
    product_code: value.product_code,
    product_name: value.product_name,
    source: 'provider_object' as const
  }
})

const handoffSchema = z.object({
  summary: z.string(),
  customer_need: z.string(),
  recommended_product: recommendedProductSchema,
  evidence: z.array(z.string()).min(1),
  risks: z.array(z.string()).default([]),
  next_steps: z.array(z.string()).min(1)
})

const schemaByMode = {
  customer_profiling: profileSchema,
  product_matching: matchSchema,
  outreach_drafting: draftSchema,
  reply_qualification: replySchema,
  handoff_summary: handoffSchema
} satisfies Record<AgentMode, z.ZodTypeAny>

const modeLabels: Record<AgentMode, string> = {
  customer_profiling: '客户画像',
  product_matching: '产品匹配',
  outreach_drafting: '建联内容生成',
  reply_qualification: '客户回复判断',
  handoff_summary: '人工交接摘要'
}

type TestProvider = (mode: AgentMode, context: unknown) => unknown | Promise<unknown>

let testProvider: TestProvider | null = null
let deferAgentExecutionForTests = false

/** Test-only: mock Provider JSON (no network). Pass null to clear. */
export function setAgentProviderForTests(provider: TestProvider | null) {
  testProvider = provider
}

/** Test-only: when true, createAgentTask does not auto-run via setTimeout. */
export function setDeferAgentExecutionForTests(defer: boolean) {
  deferAgentExecutionForTests = defer
}

export function resetAgentTestHooks() {
  testProvider = null
  deferAgentExecutionForTests = false
}

export function getAgentSchemas() {
  return schemaByMode
}

export function buildTargetContext(mode: AgentMode, targetId: string, input: Record<string, any> = {}) {
  return targetContext(mode, targetId, input)
}

export function applyAgentResult(taskId: string, mode: AgentMode, targetId: string, result: any, input: Record<string, any> = {}) {
  return applyResult(taskId, mode, targetId, result, input)
}

/** Test-only: run a queued task immediately with the current (possibly mocked) provider. */
export async function runAgentTaskNow(taskId: string) {
  await runTask(taskId, getConfig())
}

function getConfig(): RuntimeAgentConfig {
  const config = useRuntimeConfig()
  return {
    // Provider names come from .env and may be written as `Minimax`.
    provider: String(config.llmProvider || 'openai-compatible').trim().toLowerCase(),
    baseURL: String(config.llmBaseUrl || ''),
    apiKey: String(config.llmApiKey || ''),
    model: String(config.llmModel || ''),
    thinkingMode: String(config.llmThinkingMode || 'disabled'),
    reasoningEffort: String(config.llmReasoningEffort || 'high'),
    contextWindowTokens: Number(config.llmContextWindowTokens || 128000),
    modelMaxOutputTokens: Number(config.llmModelMaxOutputTokens || 32768),
    maxOutputTokens: Number(config.llmMaxOutputTokens || 65536),
    timeout: Number(config.llmTimeoutMs || 180000),
    maxRetries: Number(config.llmMaxRetries || 2),
    temperature: Number(config.llmTemperature || 0.1)
  }
}

function taskStep(taskId: string, phase: string, summary: string, data: unknown = {}) {
  const db = getDb()
  const sequence = Number((db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 value FROM agent_task_steps WHERE task_id = ?').get(taskId) as any).value)
  db.prepare(`INSERT INTO agent_task_steps (id, task_id, sequence, phase, summary, data_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(newId('step'), taskId, sequence, phase, summary, JSON.stringify(data), demoNow(db))
}

function updateTask(taskId: string, patch: { status?: string, phase?: string, progress?: number, currentStep?: string, error?: string, result?: unknown, completed?: boolean }) {
  const db = getDb()
  const current = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId) as any
  if (!current) return
  db.prepare(`UPDATE agent_tasks SET status = ?, phase = ?, progress = ?, current_step = ?, error = ?, result_json = ?, completed_at = ? WHERE id = ?`)
    .run(
      patch.status ?? current.status,
      patch.phase ?? current.phase,
      patch.progress ?? current.progress,
      patch.currentStep ?? current.current_step,
      patch.error ?? current.error,
      patch.result === undefined ? current.result_json : JSON.stringify(patch.result),
      patch.completed ? demoNow(db) : current.completed_at,
      taskId
    )
}

function parseJsonResponse(content: unknown) {
  const raw = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '').join('')
      : JSON.stringify(content) || ''
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first < 0 || last < first) throw new Error('模型未返回可解析的 JSON 对象')
  return JSON.parse(cleaned.slice(first, last + 1))
}

function targetContext(mode: AgentMode, targetId: string, input: Record<string, any>) {
  const db = getDb()
  if (mode === 'customer_profiling' || mode === 'product_matching') {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(targetId) as any
    if (!customer) throw new Error('客户不存在')
    const contacts = db.prepare('SELECT name, title, email, status FROM contacts WHERE customer_id = ?').all(targetId)
    const base = {
      customer: {
        id: customer.id,
        name: customer.name,
        source: customer.source,
        country: customer.country,
        city: customer.city,
        type: customer.customer_type,
        raw_source: JSON.parse(customer.raw_json || '{}'),
        standardized_facts: JSON.parse(customer.facts_json || '{}'),
        previous_ai_profile: JSON.parse(customer.ai_profile_json || '{}'),
        profile_version: customer.profile_version,
        contacts
      }
    }
    if (mode === 'product_matching') {
      const products = (db.prepare('SELECT * FROM products WHERE published = 1 ORDER BY code').all() as any[]).map(product => ({
        id: product.id,
        code: product.code,
        name: product.name,
        transport_mode: product.transport_mode,
        routes: JSON.parse(product.routes_json || '[]'),
        cargo_types: JSON.parse(product.cargo_types_json || '[]'),
        capabilities: JSON.parse(product.capabilities_json || '[]'),
        quote_ready: Boolean(product.quote_ready),
        transit_time: product.transit_time,
        product_version: product.product_version
      }))
      return { ...base, deterministic_filter: '仅含已发布产品；硬阻断项必须单独列出，不得用分数掩盖。', products }
    }
    return base
  }

  const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(targetId) as any
  if (!opportunity) throw new Error('获客机会不存在')
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(opportunity.customer_id) as any
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(opportunity.product_id) as any
  const contact = opportunity.contact_id ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(opportunity.contact_id) as any : null
  const events = db.prepare('SELECT title, description, source, created_at FROM opportunity_events WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 30').all(targetId)
  const drafts = db.prepare('SELECT language, subject, body, status, created_at FROM email_drafts WHERE opportunity_id = ? ORDER BY version DESC').all(targetId)
  return {
    opportunity: { ...opportunity, customer: undefined, product: undefined },
    customer: {
      name: customer.name,
      source: customer.source,
      country: customer.country,
      customer_type: customer.customer_type,
      facts: JSON.parse(customer.facts_json || '{}'),
      ai_profile: JSON.parse(customer.ai_profile_json || '{}')
    },
    product: {
      code: product.code,
      name: product.name,
      routes: JSON.parse(product.routes_json || '[]'),
      cargo_types: JSON.parse(product.cargo_types_json || '[]'),
      capabilities: JSON.parse(product.capabilities_json || '[]'),
      quote_ready: Boolean(product.quote_ready),
      reference_price: product.reference_price,
      transit_time: product.transit_time,
      marketing: JSON.parse(product.marketing_json || '{}')
    },
    contact: contact ? { name: contact.name, title: contact.title, email: contact.email, status: contact.status } : null,
    timeline: events,
    drafts,
    operator_input: input
  }
}

function systemPrompt(mode: AgentMode) {
  const common = `你是百运科技跨境物流获客系统的 Acquisition Agent。你只基于给定事实判断，不得虚构客户事实、价格或资质。原始事实与 AI 推断必须分开。输出必须是一个 JSON 对象，不得添加 Markdown、解释或隐藏推理。所有 evidence 必须引用输入中可核验的信息。`
  const customerTypeList = CUSTOMER_TYPES.join('、')
  const prompts: Record<AgentMode, string> = {
    customer_profiling: `${common}\n任务：形成结构化客户画像。customer_type 使用 ${customerTypeList}。输出字段：customer_type, summary, likely_needs[], capabilities[], target_lanes[], confidence(low|medium|high), evidence[], missing_information[], suggested_next_action。`,
    product_matching: `${common}\n任务：从已发布产品中选择最多 3 个公司×产品匹配。分数仅用于排序，不是成交概率。先识别硬阻断，再做语义匹配。输出字段：matches[{product_code, fit_score(0-100), confidence(low|medium|high), evidence[], risks[], missing_information[], hard_blockers[]}]。`,
    outreach_drafting: `${common}\n任务：生成建联邮件。默认中文；operator_input.language=en 时生成英文。邮件应专业、克制、个性化，明确匹配依据和单一行动号召，不承诺未确认价格。输出字段：language(zh|en), subject, body, evidence[], call_to_action。`,
    reply_qualification: `${common}\n任务：判断客户回复是否构成明确意向。只有具体询价/货量/路线/时效、要求会议、明确合作或要求负责人跟进才是 explicit；泛泛索要资料是 ambiguous；自动回复是 auto_reply。输出字段：intent(explicit|ambiguous|not_interested|auto_reply), confidence, evidence[], summary, next_action。`,
    handoff_summary: `${common}\n任务：生成给人工负责人的交接摘要。recommended_product 优先输出对象 {product_code, product_name}；也可兼容非空产品名字符串。输出字段：summary, customer_need, recommended_product, evidence[], risks[], next_steps[]。`
  }
  return prompts[mode]
}

async function callModel(config: RuntimeAgentConfig, mode: AgentMode, context: unknown) {
  if (testProvider) {
    const raw = await testProvider(mode, context)
    return {
      parsed: schemaByMode[mode].parse(typeof raw === 'string' ? parseJsonResponse(raw) : raw),
      usage: null
    }
  }
  if (!config.baseURL || !config.apiKey || !config.model) throw new Error('Model Endpoint 未配置，请设置 LLM_BASE_URL、LLM_API_KEY 和 LLM_MODEL')
  if (config.maxOutputTokens > config.contextWindowTokens) throw new Error('模型最大输出长度不能超过上下文长度')
  if (config.maxOutputTokens > config.modelMaxOutputTokens) throw new Error(`LLM_MAX_OUTPUT_TOKENS 不能超过模型上限 ${config.modelMaxOutputTokens}`)
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: config.timeout, maxRetries: config.maxRetries })
  const request: any = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt(mode) },
      { role: 'user', content: JSON.stringify(context) }
    ],
    max_tokens: config.maxOutputTokens
  }
  if (config.provider === 'deepseek') {
    request.thinking = { type: config.thinkingMode }
    if (config.thinkingMode === 'enabled') request.reasoning_effort = config.reasoningEffort
    else request.temperature = config.temperature
  } else {
    request.temperature = config.temperature
    request.response_format = { type: 'json_object' }
  }
  const response = await client.chat.completions.create(request)
  const choice = response.choices[0]
  if (!choice?.message?.content) throw new Error('模型没有返回业务结果')
  if (choice.finish_reason === 'length') throw new Error('模型输出达到长度上限，请缩小上下文或提高输出预算')
  return {
    parsed: schemaByMode[mode].parse(parseJsonResponse(choice.message.content)),
    usage: response.usage ? {
      prompt_tokens: response.usage.prompt_tokens,
      completion_tokens: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens
    } : null
  }
}

function applyResult(taskId: string, mode: AgentMode, targetId: string, result: any, input: Record<string, any>) {
  const db = getDb()
  const now = demoNow(db)
  if (mode === 'customer_profiling') {
    const profile = {
      summary: result.summary,
      customerType: result.customer_type,
      likelyNeeds: result.likely_needs,
      capabilities: result.capabilities,
      targetLanes: result.target_lanes,
      confidence: result.confidence,
      evidence: result.evidence,
      missingInformation: result.missing_information,
      suggestedNextAction: result.suggested_next_action,
      generatedByTaskId: taskId
    }
    db.prepare(`UPDATE customers SET customer_type = ?, ai_profile_json = ?, ai_profile_status = 'suggested', last_activity_at = ?, updated_at = ? WHERE id = ?`)
      .run(result.customer_type, JSON.stringify(profile), now, now, targetId)
    const opps = db.prepare('SELECT * FROM opportunities WHERE customer_id = ? AND status = ?').all(targetId, 'active') as any[]
    for (const opp of opps) {
      if (opp.stage < 2) db.prepare('UPDATE opportunities SET stage = 2, next_action = ?, updated_at = ? WHERE id = ?').run('等待 Agent 完成产品匹配', now, opp.id)
      addEvent({ opportunityId: opp.id, customerId: targetId, type: 'profile_completed', title: 'AI 客户画像完成', description: result.summary, source: 'agent', data: { taskId, evidence: result.evidence } }, db)
    }
    addEvent({ customerId: targetId, type: 'profile_completed', title: 'AI 客户画像完成', description: result.summary, source: 'agent', data: { taskId, evidence: result.evidence } }, db)
  }

  if (mode === 'product_matching') {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(targetId) as any
    const resolved: Array<{ match: any, product: any }> = []
    for (const match of result.matches) {
      const product = db.prepare('SELECT * FROM products WHERE code = ? AND published = 1').get(match.product_code) as any
      if (product) resolved.push({ match, product })
    }
    if (resolved.length === 0) {
      throw new Error('没有可用的已发布产品匹配结果；未发布产品不得落库，也不得标记为有效匹配完成')
    }
    markNonAcceptedMatchesStale(targetId, db, now)
    for (const { match, product } of resolved) {
      db.prepare(`INSERT INTO match_results
        (id, customer_id, product_id, score, confidence, evidence_json, risks_json, missing_json, blockers_json,
         customer_version, product_version, stale, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'proposed', ?, ?)
        ON CONFLICT(customer_id, product_id, customer_version, product_version) DO UPDATE SET
          score = excluded.score, confidence = excluded.confidence, evidence_json = excluded.evidence_json,
          risks_json = excluded.risks_json, missing_json = excluded.missing_json, blockers_json = excluded.blockers_json,
          stale = 0, updated_at = excluded.updated_at`)
        .run(newId('match'), targetId, product.id, Math.round(match.fit_score), match.confidence, JSON.stringify(match.evidence),
          JSON.stringify(match.risks), JSON.stringify(match.missing_information), JSON.stringify(match.hard_blockers),
          customer.profile_version, product.product_version, now, now)
    }
    const opps = db.prepare('SELECT * FROM opportunities WHERE customer_id = ? AND status = ?').all(targetId, 'active') as any[]
    for (const opp of opps) {
      if (opp.stage < 3) db.prepare('UPDATE opportunities SET stage = 3, next_action = ?, updated_at = ? WHERE id = ?').run('人工确认最合适的产品匹配', now, opp.id)
      addEvent({ opportunityId: opp.id, customerId: targetId, type: 'matching_completed', title: 'AI 产品匹配完成', description: '已生成最多 3 个公司×产品候选，等待人工确认。', source: 'agent', data: { taskId } }, db)
    }
    addEvent({ customerId: targetId, type: 'matching_completed', title: 'AI 产品匹配完成', description: '已生成最多 3 个公司×产品候选。', source: 'agent', data: { taskId } }, db)
  }

  if (mode === 'outreach_drafting') {
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(targetId) as any
    const contact = opportunity.contact_id
      ? db.prepare('SELECT email, status FROM contacts WHERE id = ?').get(opportunity.contact_id) as any
      : null
    const recipient = String(contact?.email || '').trim()
    if (!opportunity.contact_id || !isValidOutreachContact(contact)) {
      throw new Error('missing_contact: 缺少状态为可联系(contactable)且含有效收件邮箱的联系人，无法生成建联草稿')
    }
    const version = Number((db.prepare('SELECT COALESCE(MAX(version), 0) + 1 value FROM email_drafts WHERE opportunity_id = ? AND language = ?').get(targetId, result.language) as any).value)
    db.exec('BEGIN')
    try {
      db.prepare(`INSERT INTO email_drafts
        (id, opportunity_id, version, language, subject, body, status, recipient, sent_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, '', ?)`)
        .run(newId('draft'), targetId, version, result.language, result.subject, result.body, recipient, now)
      if (result.language === 'zh' && opportunity.stage < 5) {
        db.prepare(`UPDATE opportunities SET stage = 5, next_action = '人工审核并发送建联邮件', blocker = '', updated_at = ? WHERE id = ?`).run(now, targetId)
      }
      addEvent({ opportunityId: targetId, customerId: opportunity.customer_id, type: 'draft_ready', title: result.language === 'en' ? '英文版本已生成' : '建联内容已就绪', description: `Agent 已生成${result.language === 'en' ? '英文' : '中文'}建联邮件，等待人工审核。`, source: 'agent', data: { taskId, evidence: result.evidence } }, db)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  if (mode === 'reply_qualification') {
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(targetId) as any
    const explicit = result.intent === 'explicit'
    const nextStage = explicit ? 8 : Math.max(7, opportunity.stage)
    const blocker = result.intent === 'ambiguous' ? '回复意向模糊，需要人工复核' : result.intent === 'not_interested' ? 'AI 判断客户可能无意向，需人工确认' : result.intent === 'auto_reply' ? '自动回复，不构成客户意向' : ''
    db.prepare(`UPDATE opportunities SET stage = ?, next_action = ?, blocker = ?, ai_summary = ?, updated_at = ? WHERE id = ?`)
      .run(nextStage, result.next_action, blocker, result.summary, now, targetId)
    addEvent({ opportunityId: targetId, customerId: opportunity.customer_id, type: 'reply_qualified', title: explicit ? 'Agent 判断为明确意向' : 'Agent 已完成回复判断', description: result.summary, source: 'agent', data: { taskId, intent: result.intent, evidence: result.evidence } }, db)
  }

  if (mode === 'handoff_summary') {
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(targetId) as any
    db.prepare('UPDATE opportunities SET ai_summary = ?, updated_at = ? WHERE id = ?').run(result.summary, now, targetId)
    addEvent({
      opportunityId: targetId,
      customerId: opportunity.customer_id,
      type: 'handoff_summary',
      title: 'Agent 交接摘要已生成',
      description: result.summary,
      source: 'agent',
      data: {
        taskId,
        risks: result.risks,
        nextSteps: result.next_steps,
        recommended_product: result.recommended_product
      }
    }, db)
  }
}

async function runTask(taskId: string, config: RuntimeAgentConfig) {
  const db = getDb()
  const task = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId) as any
  if (!task || task.status === 'stopped') return
  const mode = task.mode as AgentMode
  const input = JSON.parse(task.input_json || '{}')
  try {
    db.prepare(`UPDATE agent_tasks SET status = 'running', phase = 'thinking', progress = 20, current_step = ?, started_at = ? WHERE id = ?`)
      .run(`${modeLabels[mode]}：正在整理事实与证据`, demoNow(db), taskId)
    taskStep(taskId, 'context', '已读取目标对象、原始事实与业务历史', { targetType: task.target_type, targetId: task.target_id })
    const context = targetContext(mode, task.target_id, input)
    updateTask(taskId, { phase: 'generating', progress: 48, currentStep: `${config.model} 正在判断并生成结构化建议` })
    taskStep(taskId, 'model_request', '已向模型提交结构化业务上下文', {
      provider: config.provider,
      model: config.model,
      thinkingMode: config.thinkingMode,
      reasoningEffort: config.reasoningEffort,
      contextWindowTokens: config.contextWindowTokens,
      modelMaxOutputTokens: config.modelMaxOutputTokens,
      maxOutputTokens: config.maxOutputTokens
    })
    const response = await callModel(config, mode, context)
    updateTask(taskId, { phase: 'executing', progress: 78, currentStep: '正在校验结果并执行系统工具' })
    taskStep(taskId, 'model_result', '模型已返回结构化业务结果', { usage: response.usage, resultFields: Object.keys(response.parsed as object) })
    applyResult(taskId, mode, task.target_id, response.parsed, input)
    taskStep(taskId, 'tool_result', '业务工具执行完成，相关记录已更新', { writeScope: mode })
    updateTask(taskId, { status: 'completed', phase: 'completed', progress: 100, currentStep: `${modeLabels[mode]}已完成`, result: response.parsed, completed: true })

    if (mode === 'customer_profiling' && input.autoMatch !== false) {
      createAgentTask('product_matching', 'customer', task.target_id, { triggeredBy: taskId })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    taskStep(taskId, 'failed', 'Agent 任务失败', { reason: message })
    updateTask(taskId, { status: 'failed', phase: 'failed', currentStep: '任务失败，可安全重试', error: message, completed: true })
  }
}

export function createAgentTask(mode: AgentMode, targetType: string, targetId: string, input: Record<string, any> = {}) {
  const db = getDb()
  const existing = db.prepare(`SELECT * FROM agent_tasks WHERE mode = ? AND target_type = ? AND target_id = ?
    AND status IN ('queued', 'running', 'waiting') ORDER BY created_at DESC LIMIT 1`).get(mode, targetType, targetId) as any
  if (existing) return { task: existing, duplicate: true }

  const config = getConfig()
  const id = newId('task')
  const now = demoNow(db)
  db.prepare(`INSERT INTO agent_tasks
    (id, mode, target_type, target_id, status, phase, progress, current_step, model, error, input_json, result_json, created_at, started_at, completed_at)
    VALUES (?, ?, ?, ?, 'queued', 'requesting', 5, ?, ?, '', ?, '{}', ?, '', '')`)
    .run(id, mode, targetType, targetId, `${modeLabels[mode]}任务已进入队列`, config.model, JSON.stringify(input), now)
  taskStep(id, 'requesting', '已创建 Agent 任务，等待模型处理', { mode, targetType, targetId })
  if (!deferAgentExecutionForTests) {
    setTimeout(() => { void runTask(id, config) }, 40)
  }
  return { task: db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id), duplicate: false }
}

export function stopAgentTask(taskId: string) {
  const db = getDb()
  const task = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId) as any
  if (!task) throw new Error('任务不存在')
  if (!['queued', 'running', 'waiting'].includes(task.status)) return task
  db.prepare(`UPDATE agent_tasks SET status = 'stopped', phase = 'stopped', current_step = '已由操作者停止', completed_at = ? WHERE id = ?`)
    .run(demoNow(db), taskId)
  taskStep(taskId, 'stopped', '操作者停止了 Agent 任务')
  return db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId)
}
