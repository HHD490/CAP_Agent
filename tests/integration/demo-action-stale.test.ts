import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import actionHandler from '../../server/api/demo/action.post'
import { newId } from '../../server/utils/db'
import { isValidOutreachContact } from '../../server/utils/contact'

function insertMatch(db: any, row: {
  id: string
  customerId: string
  productId: string
  status: string
  stale: number
  customerVersion?: number
  productVersion?: number
}) {
  const now = '2026-07-17T02:00:00.000Z'
  db.prepare(`INSERT INTO match_results
    (id, customer_id, product_id, score, confidence, evidence_json, risks_json, missing_json, blockers_json,
     customer_version, product_version, stale, status, created_at, updated_at)
    VALUES (?, ?, ?, 80, 'high', '[]', '[]', '[]', '[]', ?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.customerId, row.productId, row.customerVersion ?? 1, row.productVersion ?? 1, row.stale, row.status, now, now)
}

describe('DEMO-ACTION: accepted stale protection and contact validity', () => {
  it('DEMO-STALE-001: update_customer must not stale accepted matches', async () => {
    const { db } = useIsolatedDb()
    const customerId = 'customer-web-01'
    db.prepare(`DELETE FROM match_results WHERE customer_id = ?`).run(customerId)
    insertMatch(db, { id: 'da-acc', customerId, productId: 'product-by001', status: 'accepted', stale: 0, customerVersion: 1 })
    insertMatch(db, { id: 'da-prop', customerId, productId: 'product-by002', status: 'proposed', stale: 0, customerVersion: 1 })

    await actionHandler({
      __body: { action: 'update_customer', id: customerId, data: { facts: { note: 'bump' } } }
    } as any)

    expect(Number((db.prepare('SELECT stale FROM match_results WHERE id = ?').get('da-acc') as any).stale)).toBe(0)
    expect((db.prepare('SELECT status FROM match_results WHERE id = ?').get('da-acc') as any).status).toBe('accepted')
    expect(Number((db.prepare('SELECT stale FROM match_results WHERE id = ?').get('da-prop') as any).stale)).toBe(1)
  })

  it('DEMO-STALE-002: update_product must not stale accepted matches', async () => {
    const { db } = useIsolatedDb()
    const productId = 'product-by001'
    db.prepare(`DELETE FROM match_results WHERE product_id = ?`).run(productId)
    insertMatch(db, { id: 'dp-acc', customerId: 'customer-web-01', productId, status: 'accepted', stale: 0, productVersion: 1 })
    insertMatch(db, { id: 'dp-prop', customerId: 'customer-web-02', productId, status: 'proposed', stale: 0, productVersion: 1 })

    await actionHandler({
      __body: { action: 'update_product', id: productId, data: { marketing: { headline: 'updated' } } }
    } as any)

    expect(Number((db.prepare('SELECT stale FROM match_results WHERE id = ?').get('dp-acc') as any).stale)).toBe(0)
    expect((db.prepare('SELECT status FROM match_results WHERE id = ?').get('dp-acc') as any).status).toBe('accepted')
    expect(Number((db.prepare('SELECT stale FROM match_results WHERE id = ?').get('dp-prop') as any).stale)).toBe(1)
  })

  it('CONTACT-VALID-001: shared helper rejects whitespace-only email even when contactable', () => {
    expect(isValidOutreachContact({ status: 'contactable', email: 'ok@example.com' })).toBe(true)
    expect(isValidOutreachContact({ status: 'contactable', email: '   ' })).toBe(false)
    expect(isValidOutreachContact({ status: 'verify', email: 'ok@example.com' })).toBe(false)
    expect(isValidOutreachContact(null)).toBe(false)
  })

  it('CONTACT-VALID-002: set_contact rejects contactable + whitespace email (aligned with Agent)', async () => {
    const { db } = useIsolatedDb()
    const now = '2026-07-17T02:00:00.000Z'
    const contactId = newId('contact')
    db.prepare(`INSERT INTO contacts
      (id, customer_id, name, title, email, email_normalized, status, is_primary, created_at, updated_at)
      VALUES (?, 'customer-web-03', '空白邮箱', '物流', '   ', '', 'contactable', 0, ?, ?)`)
      .run(contactId, now, now)

    await expect(actionHandler({
      __body: { action: 'set_contact', id: 'opp-06', data: { contactId } }
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringMatching(/可联系|邮箱/)
    })
  })

  it('CONTACT-VALID-003: accept_match with whitespace email does not treat contact as valid', async () => {
    const { db } = useIsolatedDb()
    const now = '2026-07-17T02:00:00.000Z'
    const contactId = newId('contact')
    db.prepare(`INSERT INTO contacts
      (id, customer_id, name, title, email, email_normalized, status, is_primary, created_at, updated_at)
      VALUES (?, 'customer-wca-01', '空白', '物流', '  ', '', 'contactable', 0, ?, ?)`)
      .run(contactId, now, now)
    // Use seed match-01 which is already accepted for customer-wca-01 / product-by001 — create a fresh proposed match.
    const matchId = newId('match')
    insertMatch(db, {
      id: matchId,
      customerId: 'customer-wca-01',
      productId: 'product-sim010',
      status: 'proposed',
      stale: 0
    })

    const result = await actionHandler({
      __body: { action: 'accept_match', id: matchId, data: { contactId } }
    } as any)

    expect(result.ok).toBe(true)
    expect(result.task).toBeNull()
    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(result.opportunityId) as any
    expect(String(opp.blocker)).toMatch(/联系人/)
  })
})
