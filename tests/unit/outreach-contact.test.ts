import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import {
  createAgentTask,
  runAgentTaskNow,
  setAgentProviderForTests
} from '../../server/utils/agent'
import { newId } from '../../server/utils/db'

const zhDraft = {
  language: 'zh',
  subject: '关于中东空运合作的沟通',
  body: '您好，基于贵司汽配出口需求，我们希望进一步沟通中东空运门到门方案。',
  evidence: ['官网询价目的地为迪拜', '匹配产品为中东空运门到门专线'],
  call_to_action: '请回复方便沟通的时间'
}

function countDrafts(db: any, opportunityId: string) {
  return Number((db.prepare('SELECT COUNT(*) AS c FROM email_drafts WHERE opportunity_id = ?').get(opportunityId) as any).c)
}

function emptyRecipientDrafts(db: any, opportunityId?: string) {
  if (opportunityId) {
    return db.prepare(`SELECT * FROM email_drafts WHERE opportunity_id = ? AND (recipient IS NULL OR recipient = '')`).all(opportunityId)
  }
  return db.prepare(`SELECT * FROM email_drafts WHERE recipient IS NULL OR recipient = ''`).all()
}

describe('OUTREACH-CONTACT: require valid contact before drafting', () => {
  it('OUTREACH-CONTACT-001: opp-06 with empty contact_id must not create draft or advance to stage 5', async () => {
    const { db } = useIsolatedDb()
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-06') as any
    expect(opp.contact_id).toBe('')
    expect(Number(opp.stage)).toBe(4)
    expect(String(opp.blocker)).not.toBe('')
    const beforeDrafts = countDrafts(db, 'opp-06')
    const beforeBlocker = opp.blocker

    setAgentProviderForTests(async () => zhDraft)
    const { task } = createAgentTask('outreach_drafting', 'opportunity', 'opp-06', {})
    await runAgentTaskNow(task.id)

    const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-06') as any
    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any

    expect(countDrafts(db, 'opp-06')).toBe(beforeDrafts)
    expect(emptyRecipientDrafts(db)).toHaveLength(0)
    expect(Number(after.stage)).toBe(4)
    expect(String(after.blocker)).toBe(beforeBlocker)
    expect(taskRow.status).not.toBe('completed')
    expect(String(taskRow.error)).toMatch(/missing_contact|联系人|收件/i)
  })

  it('OUTREACH-CONTACT-002: contact_id present but empty email behaves like missing contact', async () => {
    const { db } = useIsolatedDb()
    const now = '2026-07-17T02:00:00.000Z'
    const contactId = newId('contact')
    db.prepare(`INSERT INTO contacts
      (id, customer_id, name, title, email, email_normalized, status, is_primary, created_at, updated_at)
      VALUES (?, 'customer-web-03', '空邮箱联系人', '物流', '', '', 'verify', 0, ?, ?)`)
      .run(contactId, now, now)
    db.prepare(`UPDATE opportunities SET contact_id = ?, stage = 4, blocker = ?, updated_at = ? WHERE id = 'opp-06'`)
      .run(contactId, '缺少可用于建联的有效联系人', now)
    const beforeDrafts = countDrafts(db, 'opp-06')
    const beforeBlocker = (db.prepare('SELECT blocker FROM opportunities WHERE id = ?').get('opp-06') as any).blocker

    setAgentProviderForTests(async () => zhDraft)
    const { task } = createAgentTask('outreach_drafting', 'opportunity', 'opp-06', {})
    await runAgentTaskNow(task.id)

    const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-06') as any
    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(countDrafts(db, 'opp-06')).toBe(beforeDrafts)
    expect(emptyRecipientDrafts(db, 'opp-06')).toHaveLength(0)
    expect(Number(after.stage)).toBe(4)
    expect(String(after.blocker)).toBe(beforeBlocker)
    expect(taskRow.status).not.toBe('completed')
    expect(String(taskRow.error)).toMatch(/missing_contact|联系人|收件|邮箱/i)
  })

  it('OUTREACH-CONTACT-003: valid contact + non-empty email creates one draft and advances zh to stage 5', async () => {
    const { db } = useIsolatedDb()
    const now = '2026-07-17T02:00:00.000Z'
    // Use opp-05 which already has a valid contactable email in seed.
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-05') as any
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(opp.contact_id) as any
    expect(String(contact.email)).toMatch(/@/)
    db.prepare(`UPDATE opportunities SET stage = 4, blocker = ?, updated_at = ? WHERE id = 'opp-05'`)
      .run('等待生成建联草稿', now)
    // Remove pre-seeded draft for opp-05 so we assert exactly one new draft.
    db.prepare(`DELETE FROM email_drafts WHERE opportunity_id = 'opp-05'`).run()
    const beforeEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE opportunity_id = 'opp-05' AND type = 'draft_ready'`).get() as any).c)

    setAgentProviderForTests(async () => zhDraft)
    const { task } = createAgentTask('outreach_drafting', 'opportunity', 'opp-05', {})
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const drafts = db.prepare(`SELECT * FROM email_drafts WHERE opportunity_id = 'opp-05'`).all() as any[]
    const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-05') as any
    const events = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE opportunity_id = 'opp-05' AND type = 'draft_ready'`).get() as any).c)

    expect(taskRow.status).toBe('completed')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].recipient).toBe(contact.email)
    expect(Number(after.stage)).toBe(5)
    expect(String(after.blocker)).toBe('')
    expect(events).toBe(beforeEvents + 1)
  })

  it('OUTREACH-CONTACT-004: failure path has no draft_ready event and does not delete historical drafts', async () => {
    const { db } = useIsolatedDb()
    const now = '2026-07-17T02:00:00.000Z'
    // Seed a historical draft on opp-06, then fail outreach due to missing contact.
    db.prepare(`INSERT INTO email_drafts
      (id, opportunity_id, version, language, subject, body, status, recipient, sent_at, created_at)
      VALUES ('draft-hist-opp06', 'opp-06', 1, 'zh', '历史草稿', '历史正文', 'draft', 'history@example.com', '', ?)`)
      .run(now)
    const beforeDraft = db.prepare(`SELECT * FROM email_drafts WHERE id = 'draft-hist-opp06'`).get() as any
    const beforeEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE opportunity_id = 'opp-06' AND type = 'draft_ready'`).get() as any).c)

    setAgentProviderForTests(async () => zhDraft)
    const { task } = createAgentTask('outreach_drafting', 'opportunity', 'opp-06', {})
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const afterDraft = db.prepare(`SELECT * FROM email_drafts WHERE id = 'draft-hist-opp06'`).get() as any
    const afterEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE opportunity_id = 'opp-06' AND type = 'draft_ready'`).get() as any).c)
    const empty = emptyRecipientDrafts(db)

    expect(taskRow.status).not.toBe('completed')
    expect(String(taskRow.error)).toMatch(/missing_contact|联系人|收件/i)
    expect(afterEvents).toBe(beforeEvents)
    expect(afterDraft).toBeTruthy()
    expect(afterDraft.subject).toBe(beforeDraft.subject)
    expect(afterDraft.recipient).toBe('history@example.com')
    expect(empty).toHaveLength(0)
  })

  async function assertInvalidContactRejected(db: any, opportunityId: string, contactId: string, status: string, email: string) {
    const now = '2026-07-17T02:00:00.000Z'
    db.prepare(`INSERT INTO contacts
      (id, customer_id, name, title, email, email_normalized, status, is_primary, created_at, updated_at)
      VALUES (?, 'customer-web-03', '待校验联系人', '物流', ?, ?, ?, 0, ?, ?)`)
      .run(contactId, email, email.trim().toLowerCase(), status, now, now)
    db.prepare(`UPDATE opportunities SET contact_id = ?, stage = 4, blocker = ?, updated_at = ? WHERE id = ?`)
      .run(contactId, '缺少可用于建联的有效联系人', now, opportunityId)
    db.prepare(`INSERT INTO email_drafts
      (id, opportunity_id, version, language, subject, body, status, recipient, sent_at, created_at)
      VALUES (?, ?, 1, 'zh', '历史草稿', '历史正文', 'draft', 'history@example.com', '', ?)`)
      .run(`draft-hist-${contactId}`, opportunityId, now)

    const beforeDrafts = countDrafts(db, opportunityId)
    const beforeOpp = db.prepare('SELECT stage, blocker FROM opportunities WHERE id = ?').get(opportunityId) as any
    const beforeEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE opportunity_id = ? AND type = 'draft_ready'`).get(opportunityId) as any).c)
    const beforeHist = db.prepare(`SELECT * FROM email_drafts WHERE id = ?`).get(`draft-hist-${contactId}`) as any

    setAgentProviderForTests(async () => zhDraft)
    const { task } = createAgentTask('outreach_drafting', 'opportunity', opportunityId, {})
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const afterOpp = db.prepare('SELECT stage, blocker FROM opportunities WHERE id = ?').get(opportunityId) as any
    const afterEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE opportunity_id = ? AND type = 'draft_ready'`).get(opportunityId) as any).c)
    const afterHist = db.prepare(`SELECT * FROM email_drafts WHERE id = ?`).get(`draft-hist-${contactId}`) as any

    expect(taskRow.status).not.toBe('completed')
    expect(String(taskRow.error)).toMatch(/missing_contact|联系人|收件|contactable|可联系/i)
    expect(countDrafts(db, opportunityId)).toBe(beforeDrafts)
    expect(emptyRecipientDrafts(db, opportunityId)).toHaveLength(0)
    expect(Number(afterOpp.stage)).toBe(Number(beforeOpp.stage))
    expect(String(afterOpp.blocker)).toBe(String(beforeOpp.blocker))
    expect(afterEvents).toBe(beforeEvents)
    expect(afterHist.subject).toBe(beforeHist.subject)
    expect(afterHist.recipient).toBe('history@example.com')
  }

  it('OUTREACH-CONTACT-005: verify status with non-empty email must not draft or advance', async () => {
    const { db } = useIsolatedDb()
    await assertInvalidContactRejected(db, 'opp-06', newId('contact'), 'verify', 'verify@example.com')
  })

  it('OUTREACH-CONTACT-006: invalid status with non-empty email must not draft or advance', async () => {
    const { db } = useIsolatedDb()
    await assertInvalidContactRejected(db, 'opp-06', newId('contact'), 'invalid', 'invalid@example.com')
  })

  it('OUTREACH-CONTACT-007: contactable with whitespace-only email is rejected', async () => {
    const { db } = useIsolatedDb()
    await assertInvalidContactRejected(db, 'opp-06', newId('contact'), 'contactable', '   ')
  })

  it('OUTREACH-CONTACT-008: contactable + non-empty email advances zh to stage 5 with one draft', async () => {
    const { db } = useIsolatedDb()
    const now = '2026-07-17T02:00:00.000Z'
    const contactId = newId('contact')
    db.prepare(`INSERT INTO contacts
      (id, customer_id, name, title, email, email_normalized, status, is_primary, created_at, updated_at)
      VALUES (?, 'customer-web-03', '可联系人', '物流', 'ok@example.com', 'ok@example.com', 'contactable', 1, ?, ?)`)
      .run(contactId, now, now)
    db.prepare(`UPDATE opportunities SET contact_id = ?, stage = 4, blocker = ?, updated_at = ? WHERE id = 'opp-06'`)
      .run(contactId, '等待建联', now)
    db.prepare(`DELETE FROM email_drafts WHERE opportunity_id = 'opp-06'`).run()

    setAgentProviderForTests(async () => zhDraft)
    const { task } = createAgentTask('outreach_drafting', 'opportunity', 'opp-06', {})
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const drafts = db.prepare(`SELECT * FROM email_drafts WHERE opportunity_id = 'opp-06'`).all() as any[]
    const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-06') as any
    expect(taskRow.status).toBe('completed')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].recipient).toBe('ok@example.com')
    expect(Number(after.stage)).toBe(5)
    expect(String(after.blocker)).toBe('')
  })

  it('OUTREACH-CONTACT-009: English path still requires contactable recipient and rejects verify contacts', async () => {
    const { db } = useIsolatedDb()
    const now = '2026-07-17T02:00:00.000Z'
    const badId = newId('contact')
    db.prepare(`INSERT INTO contacts
      (id, customer_id, name, title, email, email_normalized, status, is_primary, created_at, updated_at)
      VALUES (?, 'customer-web-03', '英文校验', '物流', 'en-verify@example.com', 'en-verify@example.com', 'verify', 0, ?, ?)`)
      .run(badId, now, now)
    db.prepare(`UPDATE opportunities SET contact_id = ?, stage = 4, blocker = ?, updated_at = ? WHERE id = 'opp-06'`)
      .run(badId, '缺少可用于建联的有效联系人', now)
    const beforeDrafts = countDrafts(db, 'opp-06')

    setAgentProviderForTests(async () => ({
      language: 'en',
      subject: 'Partnership discussion',
      body: 'Hello, we would like to discuss air freight options.',
      evidence: ['website inquiry to Dubai'],
      call_to_action: 'Please reply with a meeting slot'
    }))
    const { task } = createAgentTask('outreach_drafting', 'opportunity', 'opp-06', { language: 'en' })
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const after = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-06') as any
    expect(taskRow.status).not.toBe('completed')
    expect(String(taskRow.error)).toMatch(/missing_contact|联系人|contactable|可联系/i)
    expect(countDrafts(db, 'opp-06')).toBe(beforeDrafts)
    expect(Number(after.stage)).toBe(4)
    expect(emptyRecipientDrafts(db, 'opp-06')).toHaveLength(0)

    // Positive English path: contactable must produce draft with recipient, without requiring stage 5.
    const goodId = newId('contact')
    db.prepare(`INSERT INTO contacts
      (id, customer_id, name, title, email, email_normalized, status, is_primary, created_at, updated_at)
      VALUES (?, 'customer-web-03', '英文可联系', '物流', 'en-ok@example.com', 'en-ok@example.com', 'contactable', 1, ?, ?)`)
      .run(goodId, now, now)
    db.prepare(`UPDATE opportunities SET contact_id = ?, stage = 4, blocker = ?, updated_at = ? WHERE id = 'opp-06'`)
      .run(goodId, '等待英文草稿', now)
    db.prepare(`DELETE FROM email_drafts WHERE opportunity_id = 'opp-06'`).run()

    setAgentProviderForTests(async () => ({
      language: 'en',
      subject: 'Partnership discussion',
      body: 'Hello, we would like to discuss air freight options.',
      evidence: ['website inquiry to Dubai'],
      call_to_action: 'Please reply with a meeting slot'
    }))
    const { task: okTask } = createAgentTask('outreach_drafting', 'opportunity', 'opp-06', { language: 'en' })
    await runAgentTaskNow(okTask.id)
    const okRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(okTask.id) as any
    const drafts = db.prepare(`SELECT * FROM email_drafts WHERE opportunity_id = 'opp-06'`).all() as any[]
    const afterOk = db.prepare('SELECT * FROM opportunities WHERE id = ?').get('opp-06') as any
    expect(okRow.status).toBe('completed')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].recipient).toBe('en-ok@example.com')
    expect(drafts[0].language).toBe('en')
    expect(Number(afterOk.stage)).toBe(4) // English does not advance to stage 5
  })
})
