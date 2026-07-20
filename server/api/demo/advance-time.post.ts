import { getDb, demoNow, addEvent } from '../../utils/db'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ days?: number }>(event)
  const days = Math.max(1, Math.min(30, Number(body.days || 3)))
  const db = getDb()
  const current = new Date(demoNow(db))
  current.setUTCDate(current.getUTCDate() + days)
  const next = current.toISOString()
  db.prepare('UPDATE demo_state SET current_time = ? WHERE id = 1').run(next)

  const dueOpportunities = db.prepare(`SELECT * FROM opportunities
    WHERE status = 'active' AND stage = 6 AND due_at <> '' AND due_at <= ?`).all(next) as any[]
  for (const opportunity of dueOpportunities) {
    const sentCount = Number((db.prepare(`SELECT COUNT(*) count FROM opportunity_events WHERE opportunity_id = ? AND type = 'followup_reminder'`).get(opportunity.id) as any)?.count || 0)
    if (sentCount < 2) {
      const ordinal = sentCount === 0 ? '首次' : '第二次'
      addEvent({
        opportunityId: opportunity.id,
        customerId: opportunity.customer_id,
        type: 'followup_reminder',
        title: `${ordinal}跟进提醒已生成`,
        description: '系统只生成提醒和建议，不会自动发送邮件。',
        source: 'system'
      }, db)
      const due = new Date(next)
      due.setUTCDate(due.getUTCDate() + (sentCount === 0 ? 4 : 30))
      db.prepare('UPDATE opportunities SET next_action = ?, due_at = ?, updated_at = ? WHERE id = ?')
        .run(sentCount === 0 ? '人工审核并发送第二次跟进' : '无回复，人工决定是否暂停', due.toISOString(), next, opportunity.id)
    } else {
      db.prepare(`UPDATE opportunities SET status = 'paused', next_action = '如有新信号可重新开启', blocker = '两次跟进后仍无回复', updated_at = ? WHERE id = ?`)
        .run(next, opportunity.id)
      addEvent({ opportunityId: opportunity.id, customerId: opportunity.customer_id, type: 'paused', title: '机会已暂停', description: '两次跟进后仍无回复。', source: 'system' }, db)
    }
  }
  return { currentTime: next, reminders: dueOpportunities.length }
})
