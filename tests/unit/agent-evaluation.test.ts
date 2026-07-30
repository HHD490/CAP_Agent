import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Agent 离线评测集 (tests/agent-evaluation/core-regression.json) 的结构护栏。
 * 任何 schema / 阈值 / 用例数量破坏都会让 vitest 失败。
 *
 * 完整 reporter：node scripts/agent-eval-report.mjs --check
 */
const root = resolve(process.cwd())
const casesPath = resolve(root, 'tests/agent-evaluation/core-regression.json')
const reporterPath = resolve(root, 'scripts/agent-eval-report.mjs')

describe('AGENT-EVAL: 评测集结构护栏', () => {
  it('AGENT-EVAL-001: core-regression.json 存在且可解析', () => {
    expect(existsSync(casesPath)).toBe(true)
    const raw = readFileSync(casesPath, 'utf8')
    const suite = JSON.parse(raw)
    expect(suite.version).toBeTruthy()
    expect(suite.cases).toBeDefined()
  })

  it('AGENT-EVAL-002: 5 个 Agent mode 全部覆盖，每个 ≥20 条用例', () => {
    const suite = JSON.parse(readFileSync(casesPath, 'utf8'))
    const required = ['customer_profiling', 'product_matching', 'outreach_drafting', 'reply_qualification', 'handoff_summary']
    for (const mode of required) {
      expect(suite.cases[mode], `缺少模式 ${mode}`).toBeDefined()
      expect(suite.cases[mode].length, `${mode} 用例数`).toBeGreaterThanOrEqual(20)
    }
  })

  it('AGENT-EVAL-003: 9 个通过率阈值完整 + target ≥ minimum', () => {
    const suite = JSON.parse(readFileSync(casesPath, 'utf8'))
    const required = ['entity_extraction', 'instruction_following', 'computation', 'recommendation', 'format', 'robustness', 'consistency', 'hallucination', 'safety']
    for (const key of required) {
      const t = suite.thresholds[key]
      expect(t, `缺少 threshold ${key}`).toBeDefined()
      expect(typeof t.target).toBe('number')
      expect(typeof t.minimum).toBe('number')
      expect(t.target).toBeGreaterThanOrEqual(t.minimum)
    }
  })

  it('AGENT-EVAL-004: 核心计算和安全阈值必须 100%（不允许放宽）', () => {
    const suite = JSON.parse(readFileSync(casesPath, 'utf8'))
    expect(suite.thresholds.computation.target).toBe(1.0)
    expect(suite.thresholds.computation.minimum).toBe(1.0)
    expect(suite.thresholds.safety.target).toBe(1.0)
    expect(suite.thresholds.safety.minimum).toBe(1.0)
  })

  it('AGENT-EVAL-005: 用例 ID 全局唯一', () => {
    const suite = JSON.parse(readFileSync(casesPath, 'utf8'))
    const seen = new Set<string>()
    for (const mode of Object.keys(suite.cases)) {
      for (const c of suite.cases[mode]) {
        expect(seen.has(c.id), `重复 ID: ${c.id} (in ${mode})`).toBe(false)
        seen.add(c.id)
      }
    }
  })

  it('AGENT-EVAL-006: 高风险用例（risk=high + 非 rejection）至少采样 3 次', () => {
    const suite = JSON.parse(readFileSync(casesPath, 'utf8'))
    for (const mode of Object.keys(suite.cases)) {
      for (const c of suite.cases[mode]) {
        if (c.risk === 'high' && !c.expected_rejection) {
          expect(c.samples, `${c.id} 高风险非 rejection 必须 samples≥3`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  it('AGENT-EVAL-007: 高风险非 rejection 用例必须有一致性约束 max_diff_rate', () => {
    const suite = JSON.parse(readFileSync(casesPath, 'utf8'))
    for (const mode of Object.keys(suite.cases)) {
      for (const c of suite.cases[mode]) {
        if (c.risk === 'high' && !c.expected_rejection) {
          expect(c.max_diff_rate, `${c.id} 高风险非 rejection 必须有 max_diff_rate`).toBeDefined()
          expect(c.max_diff_rate, `${c.id} max_diff_rate 必须 ≤0.1`).toBeLessThanOrEqual(0.1)
        }
      }
    }
  })

  it('AGENT-EVAL-008: reporter 脚本存在且包含 --check 模式', () => {
    expect(existsSync(reporterPath)).toBe(true)
    const src = readFileSync(reporterPath, 'utf8')
    expect(src).toMatch(/--check/)
    expect(src).toMatch(/--stats/)
  })

  it('AGENT-EVAL-009: 至少 50% 用例覆盖对抗/边界场景（安全+鲁棒性）', () => {
    const suite = JSON.parse(readFileSync(casesPath, 'utf8'))
    let total = 0
    let counterOrBoundary = 0
    for (const mode of Object.keys(suite.cases)) {
      for (const c of suite.cases[mode]) {
        total++
        if (c.risk === 'high' || /对抗|注入|安全|越权|边界|鲁棒/i.test(c.name) || c.expected_rejection) {
          counterOrBoundary++
        }
      }
    }
    expect(counterOrBoundary / total).toBeGreaterThan(0.5)
  })

  it('AGENT-EVAL-010: 总用例数 ≥100（agent-nondeterministic-evaluator 核心回归集要求）', () => {
    const suite = JSON.parse(readFileSync(casesPath, 'utf8'))
    let total = 0
    for (const mode of Object.keys(suite.cases)) {
      total += suite.cases[mode].length
    }
    expect(total).toBeGreaterThanOrEqual(100)
  })

  it('AGENT-EVAL-011: every case is traceable to source, labels, constraints, and dataset version', () => {
    const suite = JSON.parse(readFileSync(casesPath, 'utf8'))
    for (const [mode, list] of Object.entries(suite.cases) as [string, any[]][]) {
      for (const c of list) {
        expect(typeof c.source, `${mode}/${c.id} 缺少 source`).toBe('string')
        expect(c.source.trim().length, `${mode}/${c.id} source 不能为空`).toBeGreaterThan(0)
        expect(Array.isArray(c.labels), `${mode}/${c.id} labels 必须是数组`).toBe(true)
        expect(c.labels, `${mode}/${c.id} 必须标记 mode`).toContain(mode)
        expect(c.labels, `${mode}/${c.id} 必须标记 regression`).toContain('regression')
        expect(Array.isArray(c.constraints), `${mode}/${c.id} constraints 必须是数组`).toBe(true)
        expect(c.constraints.length, `${mode}/${c.id} constraints 不能为空`).toBeGreaterThan(0)
        expect(c.dataset_version, `${mode}/${c.id} dataset_version 必须和套件版本一致`).toBe(suite.version)
      }
    }
  })

  it('AGENT-EVAL-012: every case has explicit input, verdict rules, risk, and sampling policy', () => {
    const suite = JSON.parse(readFileSync(casesPath, 'utf8'))
    for (const [mode, list] of Object.entries(suite.cases) as [string, any[]][]) {
      for (const c of list) {
        expect(c.input && typeof c.input === 'object' && !Array.isArray(c.input), `${mode}/${c.id} input 必须是对象`).toBe(true)
        const hasVerdict = Boolean(
          c.expected_fields
          || c.expected_rejection
          || c.forbidden_regex
          || c.forbidden_fields
          || c.must_contain_evidence
        )
        expect(hasVerdict, `${mode}/${c.id} 缺少可自动判定规则`).toBe(true)
        expect(['high', 'medium', 'low'], `${mode}/${c.id} risk 非法`).toContain(c.risk)
        expect(Number.isInteger(c.samples) && c.samples > 0, `${mode}/${c.id} samples 必须是正整数`).toBe(true)
        if (!c.expected_rejection) {
          expect(c.samples, `${mode}/${c.id} 非确定性用例至少采样 3 次`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  it('AGENT-EVAL-013: metadata count and mode inventory cannot drift from the case library', () => {
    const suite = JSON.parse(readFileSync(casesPath, 'utf8'))
    const modes = Object.keys(suite.cases)
    const total = Object.values(suite.cases as Record<string, any[]>).reduce((sum, list) => sum + list.length, 0)

    expect(suite.metadata.agent_modes).toEqual(modes)
    expect(suite.metadata.total_cases).toBe(total)
    expect(suite.metadata.baseline_storage).toMatch(/baselines/)
    expect(suite.metadata.sampling_strategy).toMatch(/3-5|3–5|3 到 5/)
  })

  it('AGENT-EVAL-014: committed evaluation data contains no obvious raw phone, token, or private key', () => {
    const raw = readFileSync(casesPath, 'utf8')

    expect(raw).not.toMatch(/(?<!\d)1[3-9]\d{9}(?!\d)/)
    expect(raw).not.toMatch(/\bsk-[A-Za-z0-9_-]{16,}\b/)
    expect(raw).not.toMatch(/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/)
  })
})
