#!/usr/bin/env node
/**
 * Agent 离线评测 reporter
 *
 * 用法：
 *   node scripts/agent-eval-report.mjs                    # 校验 core-regression.json 结构 + 输出报告
 *   node scripts/agent-eval-report.mjs --check           # 在 CI 中作为护栏：缺阈值/缺字段就 exit 1
 *   node scripts/agent-eval-report.mjs --stats           # 统计每个 mode 的用例数 + 风险分布
 *
 * 输入：tests/agent-evaluation/core-regression.json
 * 输出：stdout 报告（可重定向到 docs/agent-evaluation/<date>.md）
 *
 * 维护原则：
 *   - 阈值改动必须和 agent-nondeterministic-evaluator skill 文档一致
 *   - 新增 mode 时，必须在 cases 里补 ≥20 条用例
 *   - 任何 sample<3 的非确定性用例都是高风险信号
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const casesPath = resolve(root, 'tests/agent-evaluation/core-regression.json')

const args = new Set(process.argv.slice(2))
const isCheck = args.has('--check')
const isStats = args.has('--stats')

let raw
try {
  raw = readFileSync(casesPath, 'utf8')
} catch (e) {
  console.error(`[agent-eval] 无法读取 ${casesPath}: ${e.message}`)
  process.exit(2)
}

let suite
try {
  suite = JSON.parse(raw)
} catch (e) {
  console.error(`[agent-eval] core-regression.json 解析失败: ${e.message}`)
  process.exit(2)
}

const requiredModes = ['customer_profiling', 'product_matching', 'outreach_drafting', 'reply_qualification', 'handoff_summary']
const errors = []
const warnings = []

// 1) 顶层结构校验
if (!suite.version) errors.push('缺少 version')
if (!suite.thresholds) errors.push('缺少 thresholds')
if (!suite.cases) errors.push('缺少 cases')

// 2) 模式覆盖校验
const presentModes = Object.keys(suite.cases || {})
for (const mode of requiredModes) {
  if (!presentModes.includes(mode)) errors.push(`缺少模式 ${mode} 的用例集`)
}

// 3) 阈值字段校验
const requiredThresholdKeys = ['entity_extraction', 'instruction_following', 'computation', 'recommendation', 'format', 'robustness', 'consistency', 'hallucination', 'safety']
for (const key of requiredThresholdKeys) {
  if (!suite.thresholds?.[key]) errors.push(`thresholds 缺少 ${key}`)
  else {
    const t = suite.thresholds[key]
    if (typeof t.target !== 'number' || typeof t.minimum !== 'number') {
      errors.push(`thresholds.${key} 必须有数字 target 和 minimum`)
    }
  }
}

// 4) 用例数量校验：每个 mode >= 20
const modeStats = {}
let totalCases = 0
let highRisk = 0
let lowSamples = 0
for (const mode of presentModes) {
  const list = suite.cases[mode]
  modeStats[mode] = { count: list.length, high: 0, low: 0, samples_under_3: 0, with_rejection: 0, with_consistency: 0 }
  if (list.length < 20) errors.push(`${mode} 只有 ${list.length} 条用例，少于 20 的最低线`)
  for (const c of list) {
    totalCases++
    if (!c.source || typeof c.source !== 'string') errors.push(`${mode}/${c.id} 缺少 source`)
    if (!Array.isArray(c.labels) || !c.labels.includes(mode) || !c.labels.includes('regression')) {
      errors.push(`${mode}/${c.id} labels 必须包含 ${mode} 和 regression`)
    }
    if (!Array.isArray(c.constraints) || c.constraints.length === 0) errors.push(`${mode}/${c.id} 缺少 constraints`)
    if (c.dataset_version !== suite.version) errors.push(`${mode}/${c.id} dataset_version 与套件版本不一致`)
    if (!c.input || typeof c.input !== 'object' || Array.isArray(c.input)) errors.push(`${mode}/${c.id} input 必须是对象`)
    const hasVerdict = Boolean(c.expected_fields || c.expected_rejection || c.forbidden_regex || c.forbidden_fields || c.must_contain_evidence)
    if (!hasVerdict) errors.push(`${mode}/${c.id} 缺少可自动判定规则`)
    if (!Number.isInteger(c.samples) || c.samples < 1) errors.push(`${mode}/${c.id} samples 必须是正整数`)
    if (!c.expected_rejection && c.samples < 3) errors.push(`${mode}/${c.id} 非确定性用例至少采样 3 次`)
    if (c.risk === 'high') modeStats[mode].high++
    if (c.risk === 'low') modeStats[mode].low++
    if (c.samples && c.samples < 3 && !c.expected_rejection) {
      // 期望被 schema 拒绝的用例只需 1 次采样（验证拒绝路径稳定即可）
      modeStats[mode].samples_under_3++
      lowSamples++
      warnings.push(`${mode}/${c.id} samples=${c.samples} 低于非确定性最低 3 次`)
    }
    if (c.expected_rejection) modeStats[mode].with_rejection++
    if (typeof c.max_diff_rate === 'number') modeStats[mode].with_consistency++
    if (c.risk === 'high') highRisk++
  }
}
if (suite.metadata?.total_cases !== totalCases) {
  errors.push(`metadata.total_cases=${suite.metadata?.total_cases} 与实际 ${totalCases} 不一致`)
}

// 5) 报告生成
const lines = []
lines.push(`# Agent 离线评测报告`)
lines.push(``)
lines.push(`生成时间：${new Date().toISOString()}`)
lines.push(`测试集版本：${suite.version || 'unknown'}`)
lines.push(`测试集路径：tests/agent-evaluation/core-regression.json`)
lines.push(``)
lines.push(`## 总览`)
lines.push(``)
lines.push(`- **总用例数**：${totalCases}`)
lines.push(`- **覆盖模式**：${presentModes.length} / ${requiredModes.length}（${presentModes.join(', ')}）`)
lines.push(`- **高风险用例**：${highRisk}`)
lines.push(`- **采样 <3 次的用例**：${lowSamples}`)
lines.push(``)

lines.push(`## 各模式覆盖`)
lines.push(``)
lines.push(`| Mode | 用例数 | 高风险 | 低风险 | 反例 | 一致性 |`)
lines.push(`| --- | ---: | ---: | ---: | ---: | ---: |`)
for (const mode of presentModes) {
  const s = modeStats[mode]
  lines.push(`| ${mode} | ${s.count} | ${s.high} | ${s.low} | ${s.with_rejection} | ${s.with_consistency} |`)
}
lines.push(``)

lines.push(`## 通过率阈值（来自 agent-nondeterministic-evaluator skill）`)
lines.push(``)
lines.push(`| 维度 | 目标 | 最低 | 说明 |`)
lines.push(`| --- | ---: | ---: | --- |`)
const thresholdRows = [
  ['entity_extraction', '实体抽取准确率'],
  ['instruction_following', '指令遵循/约束满足'],
  ['computation', '计算正确性'],
  ['recommendation', '推荐合理性'],
  ['format', '输出格式遵循'],
  ['robustness', '鲁棒性'],
  ['consistency', '一致性差异'],
  ['hallucination', '幻觉错误率'],
  ['safety', '安全拒绝']
]
for (const [key, label] of thresholdRows) {
  const t = suite.thresholds?.[key]
  if (!t) continue
  lines.push(`| ${label} | ${(t.target * 100).toFixed(0)}% | ${(t.minimum * 100).toFixed(0)}% | ${t.rule} |`)
}
lines.push(``)

lines.push(`## 校验结果`)
lines.push(``)
if (errors.length === 0) {
  lines.push(`✅ 所有结构 / 阈值 / 用例数量校验通过`)
} else {
  lines.push(`❌ 发现 ${errors.length} 个错误：`)
  for (const e of errors) lines.push(`  - ${e}`)
}
if (warnings.length > 0) {
  lines.push(``)
  lines.push(`⚠️  ${warnings.length} 个警告：`)
  for (const w of warnings) lines.push(`  - ${w}`)
}
lines.push(``)

lines.push(`## 后续动作`)
lines.push(``)
lines.push(`1. 在 CI 中运行 \`node scripts/agent-eval-report.mjs --check\` 作为护栏`)
lines.push(`2. 接入真实模型后，每版生成 \`tests/agent-evaluation/baselines/<version>.json\``)
lines.push(`3. 与基线对比：核心指标恶化 >10% 触发专项评审`)
lines.push(`4. 人工抽检 ≥10% 复杂语义用例，结果与自动指标分开记录`)

const out = lines.join('\n')
console.log(out)

if (isCheck && errors.length > 0) {
  process.exit(1)
}
if (isStats) {
  // stats 模式只输出统计 JSON
  console.log('---STATS---')
  console.log(JSON.stringify({ totalCases, modeStats, errors: errors.length, warnings: warnings.length }, null, 2))
}
