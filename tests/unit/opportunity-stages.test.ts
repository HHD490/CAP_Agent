import { describe, expect, it } from 'vitest'
import { opportunityStages } from '../../utils/opportunity'

/**
 * utils/opportunity.ts → opportunityStages 常量合同。
 *
 * 这是一个 9 阶段常量，被以下模块隐式依赖：
 *  - server/api/demo/advance-time.post.ts: stage=6 触发跟进提醒
 *  - server/utils/state.ts: humanTasks 计数把 stage=5/8 视作"需人工介入"
 *  - server/api/demo/action.post.ts: stale_review / stage 推进 / focus 切换
 *  - pages/admin/opportunities.vue: 渲染阶段标签
 *  - pages/admin/index.vue: 阶段漏斗计数
 *
 * 任何一个常量被改名/换序/删行都会让上面的模块静默走错分支。
 * 因此本测试不验证业务行为，只验证**常量本身完整**：
 * 长度、顺序、关键索引值、as-const tuple 特性。
 *
 * 修改本常量前必须：
 *  1. 在 demo 启动台账里登记变更原因
 *  2. 同步更新所有"按 stage=N"硬编码的位置
 *  3. 在 PR 描述中列出"哪些测试需要人工复核"
 */
describe('OPPORTUNITY-STAGES: 9 阶段常量合同', () => {
  it('OPSTAGE-001: 长度恰好为 9', () => {
    expect(opportunityStages).toHaveLength(9)
  })

  it('OPSTAGE-002: 按索引逐一锁定每个阶段的文案（顺序合同）', () => {
    expect(opportunityStages[0]).toBe('客户已入库')
    expect(opportunityStages[1]).toBe('AI 画像完成')
    expect(opportunityStages[2]).toBe('产品匹配完成')
    expect(opportunityStages[3]).toBe('获客机会已确认')
    expect(opportunityStages[4]).toBe('建联内容已就绪')
    expect(opportunityStages[5]).toBe('已发送建联邮件')
    expect(opportunityStages[6]).toBe('已收到客户回复')
    expect(opportunityStages[7]).toBe('明确意向 / 待分配')
    expect(opportunityStages[8]).toBe('已分配负责人')
  })

  it('OPSTAGE-003: 关键索引与 advance-time 跟进提醒触发点对齐', () => {
    // advance-time.post.ts: 选 stage=6 + status=active + due_at<=now 的机会
    // → 写 followup_reminder 事件 / 推进 due_at
    expect(opportunityStages[5]).toBe('已发送建联邮件')
    // 如果常量被改名成"建联已发送"或"已建联"等，advance-time 的硬编码 stage=6 仍然成立
    //（数值未变），但人类读时容易混淆——这个测试同时锁住"数值=5 → 文案=已发送建联邮件"。
  })

  it('OPSTAGE-004: humanTasks 关键索引（5 / 7）与 state.ts humanTasks 计数对齐', () => {
    // state.ts: humanTasks 计数把 stage=5 或 stage=8 视作需人工介入
    // 5 → "建联内容已就绪"（草稿生成后等人工审核）
    // 8 → "明确意向 / 待分配"（等人工指派）
    expect(opportunityStages[4]).toBe('建联内容已就绪')
    expect(opportunityStages[7]).toBe('明确意向 / 待分配')
  })

  it('OPSTAGE-005: 文案互不相同（无重复、无空串）', () => {
    const unique = new Set(opportunityStages)
    expect(unique.size).toBe(opportunityStages.length)
    for (const label of opportunityStages) {
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('OPSTAGE-006: as const tuple 形态保留（length 是字面量 9）', () => {
    // `as const` 让 TypeScript 把它推断为 readonly tuple
    // 这里用 'as const' 风格断言静态可枚举（编译期可读）
    // 同时验证运行时仍可迭代、不冻结
    expect(Object.isFrozen(opportunityStages)).toBe(false)
    expect(Array.isArray(opportunityStages)).toBe(true)
    // 强制消费：让 TypeScript 在编译期检查长度（编译失败 = 常量长度被改）
    const _labels: readonly [
      '客户已入库',
      'AI 画像完成',
      '产品匹配完成',
      '获客机会已确认',
      '建联内容已就绪',
      '已发送建联邮件',
      '已收到客户回复',
      '明确意向 / 待分配',
      '已分配负责人'
    ] = opportunityStages
    expect(_labels).toBe(opportunityStages)
  })
})
