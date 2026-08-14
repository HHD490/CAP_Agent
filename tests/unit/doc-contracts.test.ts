/**
 * 流程域 PROCESS（SCOPE-NFR-2026-08-11 representative_cases 落地）：
 *   - PROCESS-001: 排除项"重新评估条件"列必非空（自动化契约测试）
 *
 * §4 当前 7 列结构（ae48726 / cc4be55 后）：
 *   col 0: #           数字编号 1-23
 *   col 1: 排除项       中文名称
 *   col 2: 来源        引用出处
 *   col 3: 原因        为什么排除
 *   col 4: 责任人       批准角色 / owner（允许"待指定（推荐 ...）"）
 *   col 5: 重新评估条件  触发器描述
 *   col 6: 时间窗（草案）具体值（允许"待 owner 指定"）
 *
 * 阈值：spec_default + UNAPPROVED（CP0 硬门禁）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TEST_SCOPE_PATH = join(__dirname, '..', '..', 'docs', 'test-scope.md')

/** 切出 §4（"排除项与假设"）的 markdown 文本块 */
function extractSection4(content: string): string {
  const section4Start = content.indexOf('## 4. 排除项与假设')
  expect(section4Start, 'docs/test-scope.md §4 必存在').toBeGreaterThan(-1)
  const section5Start = content.indexOf('\n## 5.', section4Start)
  return content.slice(section4Start, section5Start > -1 ? section5Start : undefined)
}

/** 切出 §4 表格数据行（去掉表头 + 分隔行） */
function extractDataRows(section4: string): string[] {
  return section4
    .split('\n')
    .filter((l) => {
      if (!l.startsWith('|')) return false
      // 第一列去掉前导 '|' 和空白后必须是数字（表头 '#'、分隔 '---:' 都会被排除）
      const firstCol = l.split('|')[1]?.trim() ?? ''
      return /^\d+$/.test(firstCol)
    })
}

describe('NFR-PROCESS: 文档契约（test-scope.md §4 排除项重新评估条件）', () => {
  it('PROCESS-001: docs/test-scope.md §4 排除项每行 7 列齐全 + 关键列非占位符', () => {
    const content = readFileSync(TEST_SCOPE_PATH, 'utf-8')
    const section4 = extractSection4(content)
    const dataLines = extractDataRows(section4)
    expect(dataLines.length, '§4 至少 1 行排除项').toBeGreaterThan(0)

    for (const line of dataLines) {
      const cols = line.split('|').map(s => s.trim()).filter(Boolean)

      // 列数 = 7：# / 排除项 / 来源 / 原因 / 责任人 / 重新评估条件 / 时间窗
      expect(cols.length, `§4 行 7 列：${line.slice(0, 80)}...`).toBe(7)

      // col 0: # 数字编号 1-23
      const num = Number(cols[0])
      expect(Number.isInteger(num) && num >= 1 && num <= 23, `# 列是 1-23 的整数：${line.slice(0, 80)}...`).toBe(true)

      // col 1: 排除项 - 非空
      expect(cols[1].length, `排除项非空：${line.slice(0, 80)}...`).toBeGreaterThan(0)

      // col 2: 来源 - 非空
      expect(cols[2].length, `来源非空：${line.slice(0, 80)}...`).toBeGreaterThan(0)

      // col 3: 原因 - 非空
      expect(cols[3].length, `原因非空：${line.slice(0, 80)}...`).toBeGreaterThan(0)

      // col 4: 责任人 - 非空（允许"待指定（推荐 ...）"作为合法值）
      expect(cols[4].length, `责任人非空：${line.slice(0, 80)}...`).toBeGreaterThan(0)

      // col 5: 重新评估条件 - 非空 + 不应只是占位符
      const reEvalCond = cols[5]
      expect(reEvalCond.length, `重新评估条件非空：${line.slice(0, 80)}...`).toBeGreaterThan(0)
      expect(reEvalCond, `不应是 UNKNOWN / TBD / 待定：${line.slice(0, 80)}...`).not.toMatch(/^UNKNOWN$|^TBD$|^待定$/)

      // col 6: 时间窗 - 非空（允许"待 owner 指定"作为合法值）
      expect(cols[6].length, `时间窗非空：${line.slice(0, 80)}...`).toBeGreaterThan(0)
    }
  })
})
