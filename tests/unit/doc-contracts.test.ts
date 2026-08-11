/**
 * 流程域 PROCESS（SCOPE-NFR-2026-08-11 representative_cases 落地）：
 *   - PROCESS-001: 排除项"重新评估条件"列必非空（自动化契约测试）
 *
 * 阈值：spec_default + UNAPPROVED（CP0 硬门禁）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TEST_SCOPE_PATH = join(__dirname, '..', '..', 'docs', 'test-scope.md')

describe('NFR-PROCESS: 文档契约（test-scope.md §4 排除项重新评估条件）', () => {
  it('PROCESS-001: docs/test-scope.md §4 排除项每行 4 列齐全 + 重新评估条件非空', () => {
    const content = readFileSync(TEST_SCOPE_PATH, 'utf-8')
    // 定位 §4 排除项与假设
    const section4Start = content.indexOf('## 4. 排除项与假设')
    expect(section4Start, 'docs/test-scope.md §4 必存在').toBeGreaterThan(-1)
    // §4 范围到下一节（§5）
    const section5Start = content.indexOf('\n## 5.', section4Start)
    const section4 = content.slice(section4Start, section5Start > -1 ? section5Start : undefined)

    // 提取表格行
    const tableLines = section4.split('\n').filter(l => l.startsWith('|') && !l.startsWith('|---') && !l.startsWith('| 排除项'))
    expect(tableLines.length, '§4 至少 1 行排除项').toBeGreaterThan(0)

    for (const line of tableLines) {
      const cols = line.split('|').map(s => s.trim()).filter(Boolean)
      // 列数 = 4：排除项 / 原因 / 责任人 / 重新评估条件
      expect(cols.length, `§4 行 4 列：${line.slice(0, 80)}...`).toBe(4)
      const reEvalCond = cols[3] // 第 4 列
      expect(reEvalCond.length, `重新评估条件非空：${line.slice(0, 80)}...`).toBeGreaterThan(0)
      // 不应只是占位符
      expect(reEvalCond, `不应是 UNKNOWN / TBD：${line.slice(0, 80)}...`).not.toMatch(/^UNKNOWN$|^TBD$|^待定$/)
    }
  })
})
