import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import advanceTimeHandler from '../../server/api/demo/advance-time.post'

/**
 * /api/demo/advance-time.post 业务规则：
 *  - 推进 N 天（N 钳制到 1..30）
 *  - 找出 stage=6 + status=active + due_at<=next 的 opportunity
 *  - 还没收到过 followup_reminder：发"首次跟进提醒" + 下次 due = now+4 天
 *  - 已收过 1 次：发"第二次跟进提醒" + 下次 due = now+30 天
 *  - 已收过 2 次：把状态改为 paused，blocker 写入"两次跟进后仍无回复"，发 paused 事件
 *
 * 这是 test-scope-case-designer / test-process-governor 共同关心的：
 * 演示时钟推进的副作用必须可预测、可审计。
 */

function makeOppAtStage6(db: any, opts: { id: string, dueAt: string, status?: string, followups?: number }) {
  const now = '2026-07-17T02:00:00.000Z'
  db.prepare(`INSERT INTO opportunities
    (id, customer_id, product_id, contact_id, source, stage, status, focus, owner, next_action, due_at, blocker, stale_review,
     close_reason, ai_summary, created_at, updated_at)
    VALUES (?, 'customer-wca-01', 'product-by001', 'contact-wca-01', 'active', 6, ?, 1, '', '等待回复', ?, '', 0, '', '', ?, ?)`)
    .run(opts.id, opts.status || 'active', opts.dueAt, now, now)

  // 预填历史 followup_reminder
  for (let i = 0; i < (opts.followups || 0); i++) {
    db.prepare(`INSERT INTO opportunity_events
      (id, opportunity_id, customer_id, type, title, description, source, data_json, created_at)
      VALUES (?, ?, 'customer-wca-01', 'followup_reminder', '历史提醒', '', 'system', '{}', ?)`)
      .run(`evt-fu-${opts.id}-${i}`, opts.id, opts.dueAt)
  }
}

async function advanceDays(days: number) {
  return advanceTimeHandler({ __body: { days } } as any)
}

describe('ADVANCE-TIME: 推进天数 + 跟进提醒', () => {
  it('ADV-TIME-001: 已知行为 — days=0 走默认 3 天（因 0 是 falsy，触发 || 3）', async () => {
    const { db } = useIsolatedDb()
    const before = (db.prepare(`SELECT "current_time" FROM demo_state WHERE id = 1`).get() as any).current_time
    const beforeDate = new Date(before)
    await advanceDays(0)
    const after = (db.prepare(`SELECT "current_time" FROM demo_state WHERE id = 1`).get() as any).current_time
    const afterDate = new Date(after)
    const days = (afterDate.getTime() - beforeDate.getTime()) / 86_400_000
    // 锁定当前行为：days=0 → 默认 3 天。如要拒绝 0/负数需修改源代码。
    expect(days).toBeCloseTo(3, 1)
  })

  it('ADV-TIME-001b: days=0.5 被钳制到 1（< 1 → 1 天）', async () => {
    const { db } = useIsolatedDb()
    const before = new Date((db.prepare(`SELECT "current_time" FROM demo_state WHERE id = 1`).get() as any).current_time)
    await advanceTimeHandler({ __body: { days: 0.5 } } as any)
    const after = new Date((db.prepare(`SELECT "current_time" FROM demo_state WHERE id = 1`).get() as any).current_time)
    expect((after.getTime() - before.getTime()) / 86_400_000).toBeCloseTo(1, 1)
  })

  it('ADV-TIME-002: days > 30 钳制到 30', async () => {
    const { db } = useIsolatedDb()
    const before = (db.prepare(`SELECT "current_time" FROM demo_state WHERE id = 1`).get() as any).current_time
    const beforeDate = new Date(before)
    await advanceDays(100)
    const after = (db.prepare(`SELECT "current_time" FROM demo_state WHERE id = 1`).get() as any).current_time
    const afterDate = new Date(after)
    const days = (afterDate.getTime() - beforeDate.getTime()) / 86_400_000
    expect(days).toBeCloseTo(30, 1)
  })

  it('ADV-TIME-003: 推进 3 天 → current_time 加 3 天', async () => {
    const { db } = useIsolatedDb()
    const before = (db.prepare(`SELECT "current_time" FROM demo_state WHERE id = 1`).get() as any).current_time
    const beforeDate = new Date(before)
    const result = await advanceDays(3)
    const after = (db.prepare(`SELECT "current_time" FROM demo_state WHERE id = 1`).get() as any).current_time
    const afterDate = new Date(after)
    expect((afterDate.getTime() - beforeDate.getTime()) / 86_400_000).toBeCloseTo(3, 1)
    expect(result.currentTime).toBe(after)
  })

  it('ADV-TIME-004: stage=6, due_at<=now, 无历史提醒 → 首次提醒 + due_at 加 4 天（从 next 时间起算）', async () => {
    const { db } = useIsolatedDb()
    const due = '2026-07-17T01:00:00.000Z' // 早于 demo_state current_time
    makeOppAtStage6(db, { id: 'opp-fu1', dueAt: due })

    await advanceDays(3)

    const evts = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-fu1' AND type = 'followup_reminder'`).all() as any[]
    expect(evts).toHaveLength(1)
    expect(String(evts[0].title)).toMatch(/首次/)
    expect(evts[0].source).toBe('system')

    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-fu1'`).get() as any
    expect(opp.status).toBe('active')
    expect(String(opp.next_action)).toMatch(/第二次|审核/)
    // 首次提醒：next(7-20) + 4 = 7-24
    const expectedDue = new Date('2026-07-24T02:00:00.000Z')
    expect(new Date(opp.due_at).toISOString()).toBe(expectedDue.toISOString())
  })

  it('ADV-TIME-005: stage=6, due_at<=now, 已收过 1 次 → 第二次提醒 + due_at 加 30 天', async () => {
    const { db } = useIsolatedDb()
    const due = '2026-07-17T01:00:00.000Z'
    makeOppAtStage6(db, { id: 'opp-fu2', dueAt: due, followups: 1 })

    await advanceDays(3)

    const evts = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-fu2' AND type = 'followup_reminder' ORDER BY created_at ASC`).all() as any[]
    expect(evts).toHaveLength(2)
    expect(String(evts[evts.length - 1].title)).toMatch(/第二次/)

    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-fu2'`).get() as any
    expect(opp.status).toBe('active')
    expect(String(opp.next_action)).toMatch(/无回复|人工决定/)
    // 第二次提醒：next(7-20) + 30 = 8-19
    const expectedDue = new Date('2026-08-19T02:00:00.000Z')
    expect(new Date(opp.due_at).toISOString()).toBe(expectedDue.toISOString())
  })

  it('ADV-TIME-006: stage=6, 已收过 2 次 → paused + 第三次进入 paused 事件', async () => {
    const { db } = useIsolatedDb()
    const due = '2026-07-17T01:00:00.000Z'
    makeOppAtStage6(db, { id: 'opp-fu3', dueAt: due, followups: 2 })

    await advanceDays(3)

    const opp = db.prepare(`SELECT * FROM opportunities WHERE id = 'opp-fu3'`).get() as any
    expect(opp.status).toBe('paused')
    expect(String(opp.blocker)).toMatch(/两次跟进|无回复/)
    expect(String(opp.next_action)).toMatch(/重新开启|新信号/)

    const pausedEvt = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-fu3' AND type = 'paused'`).get() as any
    expect(pausedEvt).toBeTruthy()
    expect(pausedEvt.source).toBe('system')
  })

  it('ADV-TIME-007: stage=6 但 due_at > now → 不触发', async () => {
    const { db } = useIsolatedDb()
    const due = '2026-08-01T00:00:00.000Z' // 远期
    makeOppAtStage6(db, { id: 'opp-fu4', dueAt: due })

    await advanceDays(3)

    const evts = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-fu4' AND type = 'followup_reminder'`).all() as any[]
    expect(evts).toHaveLength(0)
  })

  it('ADV-TIME-008: stage!=6 的机会不触发跟进提醒', async () => {
    const { db } = useIsolatedDb()
    const due = '2026-07-17T01:00:00.000Z'
    db.prepare(`INSERT INTO opportunities
      (id, customer_id, product_id, contact_id, source, stage, status, focus, owner, next_action, due_at, blocker, stale_review,
       close_reason, ai_summary, created_at, updated_at)
      VALUES (?, 'customer-wca-01', 'product-by001', 'contact-wca-01', 'active', 5, 'active', 1, '', '等待', ?, '', 0, '', '', ?, ?)`)
      .run('opp-stage5', due, '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z')

    await advanceDays(3)

    const evts = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-stage5' AND type = 'followup_reminder'`).all() as any[]
    expect(evts).toHaveLength(0)
  })

  it('ADV-TIME-009: status=closed/paused/handed_off 的 stage=6 不触发', async () => {
    const { db } = useIsolatedDb()
    const due = '2026-07-17T01:00:00.000Z'
    for (const status of ['closed', 'paused', 'handed_off']) {
      makeOppAtStage6(db, { id: `opp-${status}`, dueAt: due, status })
    }
    await advanceDays(3)
    for (const status of ['closed', 'paused', 'handed_off']) {
      const evts = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = ? AND type = 'followup_reminder'`).all(`opp-${status}`) as any[]
      expect(evts, `status=${status}`).toHaveLength(0)
    }
  })

  it('ADV-TIME-010: 多条同时到期 → 全部处理, reminders 计数正确（排除种子 opp-04）', async () => {
    const { db } = useIsolatedDb()
    // 关掉种子里的 stage=6 机会避免计数串扰
    db.prepare(`UPDATE opportunities SET status = 'paused' WHERE id = 'opp-04'`).run()

    const due = '2026-07-17T01:00:00.000Z'
    makeOppAtStage6(db, { id: 'opp-multi-1', dueAt: due })
    makeOppAtStage6(db, { id: 'opp-multi-2', dueAt: due })
    makeOppAtStage6(db, { id: 'opp-multi-3', dueAt: due })

    const result = await advanceDays(3)
    expect(result.reminders).toBe(3)
  })

  it('ADV-TIME-011: due_at="" 的机会不触发', async () => {
    const { db } = useIsolatedDb()
    makeOppAtStage6(db, { id: 'opp-no-due', dueAt: '' })
    await advanceDays(3)
    const evts = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-no-due' AND type = 'followup_reminder'`).all() as any[]
    expect(evts).toHaveLength(0)
  })

  it('ADV-TIME-012: 推进到 due_at 之前 → 提醒不触发 (只在跨过 due_at 时才发)', async () => {
    const { db } = useIsolatedDb()
    const due = '2026-08-01T00:00:00.000Z' // 未来 15 天
    makeOppAtStage6(db, { id: 'opp-future', dueAt: due })

    await advanceDays(3) // 现在还在 7-20
    const evts = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-future' AND type = 'followup_reminder'`).all() as any[]
    expect(evts).toHaveLength(0)
  })

  it('ADV-TIME-013: 首次提醒后 next_action 包含 "人工审核"', async () => {
    const { db } = useIsolatedDb()
    makeOppAtStage6(db, { id: 'opp-fu-action', dueAt: '2026-07-17T01:00:00.000Z' })
    await advanceDays(3)
    const opp = db.prepare(`SELECT next_action FROM opportunities WHERE id = 'opp-fu-action'`).get() as any
    expect(String(opp.next_action)).toMatch(/人工审核|第二次/)
  })
})
