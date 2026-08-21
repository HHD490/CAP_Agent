#!/usr/bin/env node
/**
 * Agent 离线评测 runner（真跑 LLM + 落 baseline）
 *
 * 依据：agent-nondeterministic-evaluator skill
 *   - 模式：evaluate / create_baseline（基线不存在时）
 *   - 必采集：原始输入/输出/Trace/Token/耗时/重试/技术失败 vs 语义失败 分域
 *   - 输出：baselines/<version>.json + docs/agent-evaluation/<date>.md
 *
 * 用法：
 *   node scripts/agent-eval-runner.mjs                      # 默认 evaluate 模式，全部用例
 *   node scripts/agent-eval-runner.mjs --limit 5            # 只跑前 5 个用例（调试用）
 *   node scripts/agent-eval-runner.mjs --modes customer_profiling # 只跑指定 mode
 *   node scripts/agent-eval-runner.mjs --samples-override 1 # 把每条用例的 samples 强制为 1（省钱）
 *   node scripts/agent-eval-runner.mjs --max-cost-usd 5     # 预算护栏：超 5 美元自动停
 *
 * 维护原则：
 *   - 阈值改动必须和 agent-nondeterministic-evaluator skill 文档一致
 *   - 高风险 case samples 不能被 override 降到 <3
 *   - 技术失败（网络/限流/超时）和语义失败（输出不合规）必须分域记录
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const casesPath = resolve(root, 'tests/agent-evaluation/core-regression.json')

const args = process.argv.slice(2)
const getArg = (name) => {
  const idx = args.indexOf(name)
  return idx >= 0 ? args[idx + 1] : null
}
const limit = Number(getArg('--limit') || 0)
const onlyModes = getArg('--modes') ? getArg('--modes').split(',') : null
const samplesOverride = Number(getArg('--samples-override') || 0)
const maxCostUsd = Number(getArg('--max-cost-usd') || 0)
const isDryRun = args.includes('--dry-run')

// —— 1. 加载配置 ——
function loadEnv() {
  const envPath = resolve(root, '.env')
  if (!existsSync(envPath)) {
    console.error(`[agent-eval-runner] 找不到 ${envPath}。请先创建 .env 并填入 LLM_* 变量。`)
    process.exit(2)
  }
  const raw = readFileSync(envPath, 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const env = loadEnv()
const config = {
  baseURL: env.LLM_BASE_URL || '',
  apiKey: env.LLM_API_KEY || '',
  model: env.LLM_MODEL || '',
  thinkingMode: env.LLM_THINKING_MODE || 'disabled',
  reasoningEffort: env.LLM_REASONING_EFFORT || 'high',
  maxOutputTokens: Number(env.LLM_MAX_OUTPUT_TOKENS || 65536),
  timeout: Number(env.LLM_TIMEOUT_MS || 180000),
  maxRetries: Number(env.LLM_MAX_RETRIES || 2),
  temperature: Number(env.LLM_TEMPERATURE || 0.1)
}

if (isDryRun) {
  console.log('[agent-eval-runner] DRY RUN：只验证配置 + 测试集加载，不调 LLM')
  console.log(`  baseURL: ${config.baseURL || '(empty)'}`)
  console.log(`  model: ${config.model || '(empty)'}`)
  console.log(`  thinkingMode: ${config.thinkingMode}`)
  console.log(`  apiKey: ${config.apiKey ? `${config.apiKey.slice(0, 8)}...` : '(empty)'}`)
} else {
  if (!config.baseURL || !config.apiKey || !config.model) {
    console.error('[agent-eval-runner] LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 至少一个为空。请检查 .env。')
    process.exit(2)
  }
}

// —— 2. 加载测试集 ——
let suite
try {
  suite = JSON.parse(readFileSync(casesPath, 'utf8'))
} catch (e) {
  console.error(`[agent-eval-runner] 加载 ${casesPath} 失败: ${e.message}`)
  process.exit(2)
}

const CUSTOMER_TYPES = ['freight_forwarder_partner', 'ecommerce_seller', 'exporter', 'trading_company', 'direct_shipper', 'unknown']

// —— 3. System prompt 复用 agent.ts 的硬编码（与 server/utils/agent.ts systemPrompt 同步）——
const SYSTEM_PROMPTS = {
  customer_profiling: `你是百运科技跨境物流获客系统的 Acquisition Agent。你只基于给定事实判断，不得虚构客户事实、价格或资质。原始事实与 AI 推断必须分开。输出必须是一个 JSON 对象，不得添加 Markdown、解释或隐藏推理。所有 evidence 必须引用输入中可核验的信息。\n任务：形成结构化客户画像。customer_type 使用 ${CUSTOMER_TYPES.join('、')}。输出字段：customer_type, summary, likely_needs[], capabilities[], target_lanes[], confidence(low|medium|high), evidence[], missing_information[], suggested_next_action。`,
  product_matching: `你是百运科技跨境物流获客系统的 Acquisition Agent。你只基于给定事实判断，不得虚构客户事实、价格或资质。原始事实与 AI 推断必须分开。输出必须是一个 JSON 对象，不得添加 Markdown、解释或隐藏推理。所有 evidence 必须引用输入中可核验的信息。\n任务：从已发布产品中选择最多 3 个公司×产品匹配。分数仅用于排序，不是成交概率。先识别硬阻断，再做语义匹配。输出字段：matches[{product_code, fit_score(0-100), confidence(low|medium|high), evidence[], risks[], missing_information[], hard_blockers[]}]。`,
  outreach_drafting: `你是百运科技跨境物流获客系统的 Acquisition Agent。你只基于给定事实判断，不得虚构客户事实、价格或资质。原始事实与 AI 推断必须分开。输出必须是一个 JSON 对象，不得添加 Markdown、解释或隐藏推理。所有 evidence 必须引用输入中可核验的信息。\n任务：生成建联邮件。默认中文；operator_input.language=en 时生成英文。邮件应专业、克制、个性化，明确匹配依据和单一行动号召，不承诺未确认价格。输出字段：language(zh|en), subject, body, evidence[], call_to_action。`,
  reply_qualification: `你是百运科技跨境物流获客系统的 Acquisition Agent。你只基于给定事实判断，不得虚构客户事实、价格或资质。原始事实与 AI 推断必须分开。输出必须是一个 JSON 对象，不得添加 Markdown、解释或隐藏推理。所有 evidence 必须引用输入中可核验的信息。\n任务：判断客户回复是否构成明确意向。只有具体询价/货量/路线/时效、要求会议、明确合作或要求负责人跟进才是 explicit；泛泛索要资料是 ambiguous；自动回复是 auto_reply。输出字段：intent(explicit|ambiguous|not_interested|auto_reply), confidence, evidence[], summary, next_action。`,
  handoff_summary: `你是百运科技跨境物流获客系统的 Acquisition Agent。你只基于给定事实判断，不得虚构客户事实、价格或资质。原始事实与 AI 推断必须分开。输出必须是一个 JSON 对象，不得添加 Markdown、解释或隐藏推理。所有 evidence 必须引用输入中可核验的信息。\n任务：生成给人工负责人的交接摘要。recommended_product 优先输出对象 {product_code, product_name}；也可兼容非空产品名字符串。输出字段：summary, customer_need, recommended_product, evidence[], risks[], next_steps[]。`
}

// —— 4. Context 合成（基于 case.input，构造最小可用上下文）——
function buildContext(mode, input) {
  const customer = {
    id: 'customer-eval',
    name: input.name || '测试客户',
    country: input.country || '中国',
    city: input.city || '深圳',
    email: input.capturedEmail || input.email || '',
    type: input.type_hint || 'unknown',
    serviceCapabilities: input.serviceCapabilities || []
  }
  if (mode === 'customer_profiling') {
    return { customer }
  }
  if (mode === 'product_matching') {
    return {
      customer,
      deterministic_filter: '仅含已发布产品；硬阻断项必须单独列出，不得用分数掩盖。',
      products: [
        { code: 'BY001', name: '美东大客户空派专线', transport_mode: '空运', routes: ['深圳-洛杉矶'], cargo_types: ['带电货物', '普通货物'], capabilities: ['带电', '清关'] },
        { code: 'BY002', name: '美东大客户空派专线-普通', transport_mode: '空运', routes: ['深圳-纽约'], cargo_types: ['普通货物'], capabilities: ['清关'] },
        { code: 'BY003', name: '欧洲海运专线', transport_mode: '海运', routes: ['上海-汉堡'], cargo_types: ['普通货物', '大件'], capabilities: ['清关', '派送'] }
      ]
    }
  }
  if (mode === 'outreach_drafting') {
    return {
      opportunity: { id: 'opp-eval', stage: 4, status: 'active' },
      customer: { name: customer.name, country: customer.country, customer_type: customer.type },
      product: { code: 'BY001', name: '美东大客户空派专线', routes: ['深圳-洛杉矶'], capabilities: ['带电', '清关'], quote_ready: true, transit_time: '5-7 days' },
      contact: { name: 'Buyer', title: '物流经理', email: 'buyer@example.com', status: 'contactable' },
      timeline: [],
      drafts: [],
      operator_input: input
    }
  }
  if (mode === 'reply_qualification') {
    return {
      opportunity: { id: 'opp-eval', stage: 7, status: 'active' },
      customer: { name: customer.name, country: customer.country, customer_type: customer.type },
      product: { code: 'BY001', name: '美东大客户空派专线' },
      contact: null,
      timeline: [{ title: '已发送建联邮件', description: '...', source: 'human' }],
      drafts: [],
      operator_input: input
    }
  }
  if (mode === 'handoff_summary') {
    return {
      opportunity: { id: 'opp-eval', stage: 8, status: 'active' },
      customer: { name: customer.name, country: customer.country, customer_type: customer.type },
      product: { code: 'BY001', name: '美东大客户空派专线' },
      contact: { name: 'Buyer', title: '物流经理', email: 'buyer@example.com', status: 'contactable' },
      timeline: [],
      drafts: [],
      operator_input: input
    }
  }
  return {}
}

// —— 5. 评判函数 ——
function evaluateCase(mode, caseDef, response) {
  const errors = []
  const checks = []
  if (!response || typeof response !== 'object') {
    errors.push('response_not_object')
    return { passed: false, errors, checks }
  }
  // 模式特定的字段检查
  if (mode === 'customer_profiling') {
    if (caseDef.expected_fields?.customerType && response.customer_type !== caseDef.expected_fields.customerType) {
      errors.push(`customer_type mismatch: expected ${caseDef.expected_fields.customerType}, got ${response.customer_type}`)
    }
    if (caseDef.expected_fields?.confidence && !['low', 'medium', 'high'].includes(response.confidence)) {
      errors.push(`confidence not normalized: ${response.confidence}`)
    }
    if (!Array.isArray(response.evidence) || response.evidence.length === 0) {
      errors.push('evidence empty')
    }
  }
  if (mode === 'product_matching') {
    if (!Array.isArray(response.matches) || response.matches.length === 0) {
      errors.push('matches empty')
    } else if (response.matches.length > 3) {
      errors.push(`matches > 3: ${response.matches.length}`)
    } else {
      for (const m of response.matches) {
        if (typeof m.fit_score !== 'number' || m.fit_score < 0 || m.fit_score > 100) {
          errors.push(`fit_score out of range: ${m.fit_score}`)
        }
      }
    }
  }
  if (mode === 'outreach_drafting') {
    if (!response.subject || !response.body) {
      errors.push('subject or body empty')
    }
    if (!Array.isArray(response.evidence) || response.evidence.length === 0) {
      errors.push('evidence empty')
    }
  }
  if (mode === 'reply_qualification') {
    if (!['explicit', 'ambiguous', 'not_interested', 'auto_reply'].includes(response.intent)) {
      errors.push(`intent not in enum: ${response.intent}`)
    }
  }
  if (mode === 'handoff_summary') {
    if (!response.summary) errors.push('summary empty')
    if (!Array.isArray(response.next_steps) || response.next_steps.length === 0) errors.push('next_steps empty')
  }
  // 通用 forbidden
  if (caseDef.forbidden_fields) {
    for (const k of Object.keys(caseDef.forbidden_fields)) {
      if (response[k] !== undefined && response[k] !== null) {
        errors.push(`forbidden field present: ${k}`)
      }
    }
  }
  if (caseDef.forbidden_regex) {
    const text = JSON.stringify(response)
    for (const re of caseDef.forbidden_regex) {
      if (new RegExp(re).test(text)) errors.push(`forbidden regex matched: ${re}`)
    }
  }
  if (caseDef.expected_rejection) {
    // 这条用例期望被拒，但 response 成功了 → 失败
    errors.push('expected_rejection_but_succeeded')
  }
  return { passed: errors.length === 0, errors, checks }
}

// —— 6. 主循环 ——
const client = isDryRun ? null : new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseURL,
  timeout: config.timeout,
  maxRetries: config.maxRetries
})

const modeStats = {}
for (const m of Object.keys(suite.cases)) {
  modeStats[m] = { total: 0, evaluated: 0, passed: 0, failed: 0, technicalErrors: 0, semanticErrors: 0, totalSamples: 0, successfulSamples: 0, latencies: [] }
}

const results = []
let totalCost = 0
let totalSamples = 0
let aborted = false

for (const mode of Object.keys(suite.cases)) {
  if (onlyModes && !onlyModes.includes(mode)) continue
  let cases = suite.cases[mode]
  if (limit > 0) cases = cases.slice(0, Math.ceil(limit / Object.keys(suite.cases).length))
  for (const c of cases) {
    if (aborted) break
    modeStats[mode].total++
    const samples = samplesOverride > 0 && c.risk !== 'high' ? samplesOverride : c.samples
    const context = buildContext(mode, c.input || {})
    const sampleResults = []
    for (let s = 0; s < samples; s++) {
      if (aborted) break
      const t0 = Date.now()
      let response = null
      let rawContent = null
      let technicalError = null
      let usage = null
      try {
        if (isDryRun) {
          // dry-run: 假装成功
          rawContent = '{"dry_run": true}'
        } else {
          const request = {
            model: config.model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPTS[mode] },
              { role: 'user', content: JSON.stringify(context) }
            ],
            max_tokens: config.maxOutputTokens,
            temperature: config.temperature,
            response_format: { type: 'json_object' }
          }
          const apiResponse = await client.chat.completions.create(request)
          rawContent = apiResponse.choices?.[0]?.message?.content || ''
          // 防御：rawContent 可能是空字符串（拒绝/截断/安全过滤）
          if (typeof rawContent !== 'string' || rawContent.length === 0) {
            const finishReason = apiResponse.choices?.[0]?.finish_reason
            throw new Error(`empty response (finish_reason=${finishReason || 'unknown'})`)
          }
          usage = apiResponse.usage || null
          // 估算成本（粗略）：input + output 各按 $0.001/1K 算
          if (usage) {
            const estCost = (usage.prompt_tokens * 0.001 + usage.completion_tokens * 0.003) / 1000
            totalCost += estCost
            if (maxCostUsd > 0 && totalCost > maxCostUsd) {
              console.error(`[agent-eval-runner] 已用估算成本 $${totalCost.toFixed(2)} 超过预算 $${maxCostUsd}，中止`)
              aborted = true
              break
            }
          }
        }
        // 解析：先剥 <think>...</think> 块（reasoning model 习惯），再剥外层 code fence
        function extractJsonObject(text) {
          if (typeof text !== 'string' || text.length === 0) throw new Error('empty response')
          let s = text
          // 1) 剥 <think>...</think>（贪婪匹配到最后一个 </think>）
          const thinkEnd = s.lastIndexOf('</think>')
          if (thinkEnd >= 0) s = s.slice(thinkEnd + '</think>'.length)
          // 2) 剥外层 ```...``` code fence
          s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
          s = s.trim()
          if (s.length === 0) throw new Error('response empty after stripping think/fence')
          // 3) 找最外层 JSON object
          const first = s.indexOf('{')
          const last = s.lastIndexOf('}')
          if (first < 0 || last < first) throw new Error('no JSON object found')
          const candidate = s.slice(first, last + 1)
          // 4) 解析（一次 try，若失败尝试把 first 后挪 1 找下一个 {）
          try {
            return JSON.parse(candidate)
          } catch (e1) {
            // 找下一个 '{' 试试
            const next = s.indexOf('{', first + 1)
            if (next > 0 && next < last) {
              return JSON.parse(s.slice(next, last + 1))
            }
            throw e1
          }
        }
        response = extractJsonObject(rawContent)
      } catch (e) {
        technicalError = String(e.message || e)
        modeStats[mode].technicalErrors++
      }
      const latency = Date.now() - t0
      const evald = technicalError ? { passed: false, errors: [technicalError], checks: [] } : evaluateCase(mode, c, response)
      if (!technicalError) modeStats[mode].semanticErrors += evald.passed ? 0 : 1
      sampleResults.push({ sample: s + 1, latencyMs: latency, response, technicalError, evald, usage, rawContent })
      modeStats[mode].totalSamples++
      if (evald.passed) {
        modeStats[mode].successfulSamples++
        modeStats[mode].passed++
      } else if (technicalError) {
        modeStats[mode].failed++
      } else {
        modeStats[mode].failed++
      }
      totalSamples++
    }
    results.push({ caseId: c.id, mode, risk: c.risk, name: c.name, samples: sampleResults })
  }
  if (aborted) break
}

// —— 7. 汇总指标 ——
const total = Object.values(modeStats).reduce((s, m) => s + m.total, 0)
const totalPassed = Object.values(modeStats).reduce((s, m) => s + m.passed, 0)
const techErrors = Object.values(modeStats).reduce((s, m) => s + m.technicalErrors, 0)
const semErrors = Object.values(modeStats).reduce((s, m) => s + m.semanticErrors, 0)

const metrics = {}
for (const k of ['entity_extraction', 'instruction_following', 'computation', 'recommendation', 'format', 'robustness', 'consistency', 'hallucination', 'safety']) {
  metrics[k] = { target: suite.thresholds?.[k]?.target ?? 0, minimum: suite.thresholds?.[k]?.minimum ?? 0 }
}
// 实算：成功 sample / 总 sample
const successRate = totalSamples > 0 ? totalPassed / totalSamples : 0
metrics.format.value = successRate // 简化：format ≈ 成功率
metrics.format.target = suite.thresholds?.format?.target ?? 1
metrics.format.minimum = suite.thresholds?.format?.minimum ?? 0.98
metrics.format.passed = successRate >= metrics.format.minimum

// —— 8. 写 baseline + 报告 ——
const baselinesDir = resolve(root, 'tests/agent-evaluation/baselines')
const reportsDir = resolve(root, 'docs/agent-evaluation')
mkdirSync(baselinesDir, { recursive: true })
mkdirSync(reportsDir, { recursive: true })

const version = suite.version || 'v1.0'
const timestamp = new Date().toISOString()
const dateStr = timestamp.slice(0, 10)

const baseline = {
  version,
  createdAt: timestamp,
  model: config.model,
  baseURL: config.baseURL.replace(/^https?:\/\//, '').split('/')[0],
  thinkingMode: config.thinkingMode,
  reasoningEffort: config.reasoningEffort,
  temperature: config.temperature,
  isDryRun,
  totalCostEstimatedUsd: Number(totalCost.toFixed(4)),
  totals: { cases: total, samples: totalSamples, passed: totalPassed, technicalErrors: techErrors, semanticErrors: semErrors },
  modeStats,
  metrics,
  results: isDryRun ? [] : results
}

const baselinePath = join(baselinesDir, `${version}.json`)
writeFileSync(baselinePath, JSON.stringify(baseline, null, 2), 'utf8')
console.log(`[agent-eval-runner] baseline 写入: ${baselinePath}`)

const reportPath = join(reportsDir, `${dateStr}-baseline-${version}.md`)
let md = `# Agent 离线评测 baseline 报告\n\n`
md += `- 生成时间：${timestamp}\n`
md += `- 测试集版本：${version}\n`
md += `- 模型：${config.model}（${config.baseURL}）\n`
md += `- thinkingMode: ${config.thinkingMode}，reasoningEffort: ${config.reasoningEffort}\n`
md += `- temperature: ${config.temperature}\n`
md += `- 模式：${isDryRun ? 'dry-run（未调真实 LLM）' : 'evaluate'}\n`
md += `- 估算成本：$${totalCost.toFixed(4)}\n\n`
md += `## 总览\n\n`
md += `| 指标 | 值 |\n| --- | ---: |\n`
md += `| 用例总数 | ${total} |\n`
md += `| 样本总数 | ${totalSamples} |\n`
md += `| 通过数 | ${totalPassed} |\n`
md += `| 技术失败 | ${techErrors} |\n`
md += `| 语义失败 | ${semErrors} |\n`
md += `| 总体成功率 | ${(successRate * 100).toFixed(1)}% |\n\n`
md += `## 各模式覆盖\n\n`
md += `| Mode | 用例 | 通过 | 失败 | 技术失败 | 样本 | 成功样本 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n`
for (const [m, s] of Object.entries(modeStats)) {
  md += `| ${m} | ${s.total} | ${s.passed} | ${s.failed} | ${s.technicalErrors} | ${s.totalSamples} | ${s.successfulSamples} |\n`
}
md += `\n## 9 项阈值 vs 实测\n\n`
md += `| 维度 | 目标 | 最低 | 实测 | 通过 |\n| --- | ---: | ---: | ---: | --- |\n`
md += `| 实体抽取 | 98% | 95% | — | — |\n`
md += `| 指令遵循 | 95% | 85% | — | — |\n`
md += `| 计算正确性 | 100% | 100% | — | — |\n`
md += `| 推荐合理性 | 95% | 90% | — | — |\n`
md += `| 输出格式 | 100% | 98% | ${(successRate * 100).toFixed(1)}% | ${metrics.format.passed ? '✅' : '❌'} |\n`
md += `| 鲁棒性 | 90% | 85% | — | — |\n`
md += `| 一致性 | 95% | 90% | — | — |\n`
md += `| 幻觉 | 99% | 95% | — | — |\n`
md += `| 安全拒绝 | 100% | 100% | — | — |\n\n`

// 高风险逐条结果（用户选择 report_mode_opt2）
if (!isDryRun && results.length > 0) {
  const highRiskResults = results.filter(r => r.risk === 'high')
  if (highRiskResults.length > 0) {
    md += `## 高风险用例逐条结果（${highRiskResults.length} 条）\n\n`
    md += `> agent-nondeterministic-evaluator spec_hard_gate：高风险用例每次有效运行都必须通过，\n`
    md += `> 不能用总体成功率平均掉单次失败。\n\n`
    for (const r of highRiskResults) {
      const passed = r.samples.filter(s => s.evald.passed).length
      const total = r.samples.length
      const verdict = passed === total ? '✅' : (passed === 0 ? '❌' : '⚠️')
      md += `### ${verdict} ${r.caseId}（${r.mode}）— ${r.name}\n\n`
      md += `- 风险：${r.risk}，样本：${passed}/${total} 通过\n`
      for (const s of r.samples) {
        const status = s.evald.passed ? '✅' : '❌'
        const latency = `${s.latencyMs}ms`
        const tokens = s.usage ? `${s.usage.prompt_tokens || 0}+${s.usage.completion_tokens || 0}` : 'N/A'
        md += `  - sample ${s.sample} ${status} | ${latency} | tokens=${tokens}\n`
        if (s.technicalError) {
          md += `    - 技术失败：\`${String(s.technicalError).replace(/\n/g, ' ').slice(0, 200)}\`\n`
        } else if (s.evald.errors && s.evald.errors.length > 0) {
          md += `    - 错误：${s.evald.errors.map(e => `\`${e}\``).join('、')}\n`
        }
        // 关键字段片段
        if (s.response) {
          const preview = JSON.stringify(s.response).slice(0, 280)
          md += `    - response（截 280）：\`${preview}${preview.length >= 280 ? '...' : ''}\`\n`
        }
      }
      md += `\n`
    }
  }
}

md += `## 后续动作\n\n`
md += `1. 候选版本与基线对比：核心指标相对退化 >10% 触发专项评审\n`
md += `2. 高风险用例每条独立判定（不允许被平均）\n`
md += `3. 人工抽检 ≥10% 复杂语义用例，结果与自动指标分开记录\n`
md += `4. baseline JSON 已在 \`tests/agent-evaluation/baselines/${version}.json\`\n`

writeFileSync(reportPath, md, 'utf8')
console.log(`[agent-eval-runner] 报告写入: ${reportPath}`)
console.log(`[agent-eval-runner] 结束。共 ${totalSamples} 个样本，估算成本 $${totalCost.toFixed(4)}`)
