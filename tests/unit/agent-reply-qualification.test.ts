import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import {
  createAgentTask,
  runAgentTaskNow,
  setAgentProviderForTests
} from '../../server/utils/agent'


/**
 * reply_qualification Agent：把客户回复分类为 4 个 intent，并推动机会到对应阶段。
 *
 * 业务规则（来自 server/utils/agent.ts applyResult → reply_qualification 分支）：
 * - explicit     → stage=8, 无 blocker, 写 ai_summary
 * - ambiguous    → stage=max(7, current), blocker='回复意向模糊，需要人工复核'
 * - not_interested → stage=max(7, current), blocker='AI 判断客户可能无意向，需人工确认'
 * - auto_reply   → stage=max(7, current), blocker='自动回复，不构成客户意向'
 *
 * 关联事件类型：reply_qualified；event.data 必须包含 taskId / intent / evidence。
 *
 * 这是 agent-nondeterministic-evaluator 的核心维度：意图分类准确率必须
 * 100% 命中业务规则，且 stage 推进符合业务期望。
 */
function baseReply(intent: 'explicit' | 'ambiguous' | 'not_interested' | 'auto_reply', confidence: 'low' | 'medium' | 'high' = 'high') {
  return {
    intent,
    confidence,
    evidence: [`客户在邮件中明确${intent === 'explicit' ? '询价并要求方案' : intent === 'ambiguous' ? '索要资料' : intent === 'not_interested' ? '婉拒' : '自动回复'}`],
    summary: `客户回复判断为 ${intent}`,
    next_action: intent === 'explicit' ? '分配负责人' : '人工复核回复内容'
  }
}

describe('AGENT-REPLY: reply_qualification intent → 业务结果', () => {
  it('AGENT-REPLY-001: explicit → stage=8, blocker="", 写 ai_summary, 事件 data 包含 intent', async () => {
    const { db } = useIsolatedDb()
    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-03'`).get() as any
    expect(Number(opp.stage)).toBeLessThan(8)

    setAgentProviderForTests(async () => baseReply('explicit', 'high'))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', { replyText: '下周有一票，请报价' })
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(taskRow.status).toBe('completed')

    const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-03') as any
    expect(Number(after.stage)).toBe(8)
    expect(String(after.blocker)).toBe('')
    expect(String(after.ai_summary)).toMatch(/客户回复判断为 explicit/)

    const event = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-03' AND type = 'reply_qualified' ORDER BY created_at DESC LIMIT 1`).get() as any
    expect(event).toBeTruthy()
    const data = JSON.parse(event.data_json || '{}')
    expect(data.intent).toBe('explicit')
    expect(data.taskId).toBe(task.id)
    expect(Array.isArray(data.evidence)).toBe(true)
    expect(data.evidence.length).toBeGreaterThan(0)
  })

  it('AGENT-REPLY-002: ambiguous → stage>=7, blocker 包含"模糊"', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => baseReply('ambiguous', 'medium'))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', { replyText: '请发资料看看' })
    await runAgentTaskNow(task.id)

    const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-03') as any
    expect(Number(after.stage)).toBeGreaterThanOrEqual(7)
    expect(String(after.blocker)).toMatch(/模糊|人工/)
  })

  it('AGENT-REPLY-003: not_interested → stage>=7, blocker 提示"无意向"', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => baseReply('not_interested', 'high'))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', { replyText: '目前不需要' })
    await runAgentTaskNow(task.id)

    const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-03') as any
    expect(Number(after.stage)).toBeGreaterThanOrEqual(7)
    expect(String(after.blocker)).toMatch(/无意向|人工/)
  })

  it('AGENT-REPLY-004: auto_reply → stage>=7, blocker 提示"自动回复"', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => baseReply('auto_reply', 'high'))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', { replyText: 'Out of office' })
    await runAgentTaskNow(task.id)

    const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-03') as any
    expect(Number(after.stage)).toBeGreaterThanOrEqual(7)
    expect(String(after.blocker)).toMatch(/自动回复/)
  })

  it('AGENT-REPLY-005: 非 explicit 不会让 stage 跨越 8（不会让"模糊"误判进待分配）', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => baseReply('ambiguous', 'high'))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', {})
    await runAgentTaskNow(task.id)

    const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-03') as any
    expect(Number(after.stage)).toBeLessThan(8)
  })

  it('AGENT-REPLY-006: explicit 已达 9 阶段时仍能落库（不退化）', async () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET stage = 9, status = 'handed_off' WHERE id = 'opp-03'`).run()

    setAgentProviderForTests(async () => baseReply('explicit', 'high'))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', {})
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-03') as any
    expect(taskRow.status).toBe('completed')
    expect(Number(after.stage)).toBeGreaterThanOrEqual(8)
  })

  it('AGENT-REPLY-007: confidence 数字 (0.92) 仍触发 explicit 路径', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => ({ ...baseReply('explicit'), confidence: 0.92 }))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', {})
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-03') as any
    expect(taskRow.status).toBe('completed')
    expect(Number(after.stage)).toBe(8)
  })

  it('AGENT-REPLY-008: reply_qualification 不创建 email_drafts（与 outreach 区分）', async () => {
    const { db } = useIsolatedDb()
    const before = Number((db.prepare(`SELECT COUNT(*) c FROM email_drafts WHERE opportunity_id = 'opp-03'`).get() as any).c)
    setAgentProviderForTests(async () => baseReply('explicit', 'high'))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', {})
    await runAgentTaskNow(task.id)

    const after = Number((db.prepare(`SELECT COUNT(*) c FROM email_drafts WHERE opportunity_id = 'opp-03'`).get() as any).c)
    expect(after).toBe(before)
  })

  it('AGENT-REPLY-009: 失败时 task 状态为 failed，opportunity 不被静默推进', async () => {
    const { db } = useIsolatedDb()
    const beforeStage = Number((db.prepare(`SELECT stage FROM opportunities WHERE id = 'opp-03'`).get() as any).stage)

    setAgentProviderForTests(async () => ({ ...baseReply('explicit'), evidence: [] }))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', {})
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(taskRow.status).toBe('failed')
    const after = Number((db.prepare(`SELECT stage FROM opportunities WHERE id = 'opp-03'`).get() as any).stage)
    expect(after).toBe(beforeStage)
  })

  it('AGENT-REPLY-010: opportunity 不存在时 task 失败并报"获客机会不存在"', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => baseReply('explicit', 'high'))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-does-not-exist', {})
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(taskRow.status).toBe('failed')
    expect(String(taskRow.error)).toMatch(/获客机会|opportunity/i)
  })

  it('AGENT-REPLY-011: ai_summary 被覆盖为最新一次结果（不累加历史）', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => ({ ...baseReply('explicit'), summary: '第一轮摘要' }))
    const { task: t1 } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', {})
    await runAgentTaskNow(t1.id)
    expect((db.prepare(`SELECT ai_summary FROM opportunities WHERE id = 'opp-03'`).get() as any).ai_summary).toBe('第一轮摘要')

    setAgentProviderForTests(async () => ({ ...baseReply('ambiguous'), summary: '第二轮摘要' }))
    const { task: t2 } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', {})
    await runAgentTaskNow(t2.id)
    expect((db.prepare(`SELECT ai_summary FROM opportunities WHERE id = 'opp-03'`).get() as any).ai_summary).toBe('第二轮摘要')
  })

  it('AGENT-REPLY-012: reply_qualified 事件 source 必须是 agent（人工事件 source=human）', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => baseReply('explicit', 'high'))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', {})
    await runAgentTaskNow(task.id)

    const event = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-03' AND type = 'reply_qualified' ORDER BY created_at DESC LIMIT 1`).get() as any
    expect(event.source).toBe('agent')
  })

  it('AGENT-REPLY-013: 业务规则保护 — 模糊/无意向不会让已关闭机会被复活', async () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE opportunities SET status = 'closed', close_reason = '已签合同' WHERE id = 'opp-03'`).run()

    setAgentProviderForTests(async () => baseReply('ambiguous', 'medium'))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', {})
    await runAgentTaskNow(task.id)

    const after = db.prepare('SELECT status, stage FROM opportunities WHERE id = ?').get('opp-03') as any
    // 状态字段不应被 reply_qualification 修改；stage 推进是业务允许的
    expect(after.status).toBe('closed')
  })

  it('AGENT-REPLY-014: 持续运行 — 同一 opportunity 多次回复判断会持续生成 reply_qualified 事件', async () => {
    const { db } = useIsolatedDb()
    const before = Number((db.prepare(`SELECT COUNT(*) c FROM opportunity_events WHERE opportunity_id = 'opp-03' AND type = 'reply_qualified'`).get() as any).c)

    setAgentProviderForTests(async () => baseReply('explicit', 'high'))
    const { task: t1 } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', {})
    await runAgentTaskNow(t1.id)
    const { task: t2 } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', { replyText: '再问一次' })
    await runAgentTaskNow(t2.id)

    const after = Number((db.prepare(`SELECT COUNT(*) c FROM opportunity_events WHERE opportunity_id = 'opp-03' AND type = 'reply_qualified'`).get() as any).c)
    expect(after).toBe(before + 2)
  })

  it('AGENT-REPLY-015: explicit 之后 next_action = "分配负责人"（业务后续由人工 assign_owner 接手）', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => ({ ...baseReply('explicit'), next_action: '分配负责人' }))
    const { task } = createAgentTask('reply_qualification', 'opportunity', 'opp-03', {})
    await runAgentTaskNow(task.id)

    const after = db.prepare('SELECT next_action FROM opportunities WHERE id = ?').get('opp-03') as any
    expect(String(after.next_action)).toBe('分配负责人')
  })
})
