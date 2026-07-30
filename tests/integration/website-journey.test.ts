import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { useIsolatedDb } from '../helpers/db'
import quoteHandler from '../../server/api/website/quote.post'
import identityHandler from '../../server/api/website/identity.post'
import rematchHandler from '../../server/api/website/rematch.post'

const quoteBody = {
  origin: '深圳',
  destination: '洛杉矶',
  cargoName: '蓝牙音箱（带电）',
  weightKg: 820,
  volumeCbm: 5.4,
  preference: '平衡价格与时效',
  details: { tradeTerm: 'DDP', shipmentDate: '2026-08-01' }
}

describe('WEBSITE-JOURNEY: quote endpoint contract and isolation', () => {
  it('WEB-QUOTE-001: new visitor creates a session and quoted inquiry with persisted details', async () => {
    const { db } = useIsolatedDb()

    const result = await quoteHandler({ __body: quoteBody } as any)
    const session = db.prepare('SELECT * FROM website_sessions WHERE id = ?').get(result.sessionId) as any
    const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(result.inquiryId) as any

    expect(session).toBeTruthy()
    expect(inquiry).toMatchObject({
      session_id: result.sessionId,
      status: 'quoted',
      origin: quoteBody.origin,
      destination: quoteBody.destination,
      cargo_name: quoteBody.cargoName,
      weight_kg: quoteBody.weightKg,
      volume_cbm: quoteBody.volumeCbm
    })
    expect(JSON.parse(inquiry.details_json)).toEqual(quoteBody.details)
    expect(JSON.parse(inquiry.recommendations_json)).toEqual(result.recommendations)
    expect(result.recommendations.length).toBeGreaterThan(0)
    expect(result.recommendations.length).toBeLessThanOrEqual(3)
    expect(result.recommendations.every((item: any) => item.code !== 'BY004')).toBe(true)
  })

  it('WEB-QUOTE-002: same session + inquiry updates in place instead of duplicating rows', async () => {
    const { db } = useIsolatedDb()
    const first = await quoteHandler({ __body: quoteBody } as any)
    const beforeCount = Number((db.prepare('SELECT COUNT(*) AS count FROM inquiries').get() as any).count)

    const second = await quoteHandler({
      __body: {
        ...quoteBody,
        sessionId: first.sessionId,
        inquiryId: first.inquiryId,
        destination: '纽约',
        weightKg: '900',
        details: { tradeTerm: 'FOB' }
      }
    } as any)
    const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(first.inquiryId) as any

    expect(second.sessionId).toBe(first.sessionId)
    expect(second.inquiryId).toBe(first.inquiryId)
    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM inquiries').get() as any).count)).toBe(beforeCount)
    expect(inquiry.destination).toBe('纽约')
    expect(inquiry.weight_kg).toBe(900)
    expect(JSON.parse(inquiry.details_json)).toEqual({ tradeTerm: 'FOB' })
  })

  it('WEB-QUOTE-003: inquiry from another session is never overwritten', async () => {
    const { db } = useIsolatedDb()
    const first = await quoteHandler({ __body: quoteBody } as any)
    const second = await quoteHandler({ __body: { ...quoteBody, destination: '东京' } } as any)

    const attempted = await quoteHandler({
      __body: {
        ...quoteBody,
        sessionId: second.sessionId,
        inquiryId: first.inquiryId,
        destination: '巴黎'
      }
    } as any)

    expect(attempted.inquiryId).not.toBe(first.inquiryId)
    expect((db.prepare('SELECT destination FROM inquiries WHERE id = ?').get(first.inquiryId) as any).destination).toBe('洛杉矶')
    expect((db.prepare('SELECT session_id FROM inquiries WHERE id = ?').get(attempted.inquiryId) as any).session_id).toBe(second.sessionId)
  })

  it('WEB-QUOTE-004: unknown session id is replaced by a server-generated session', async () => {
    const { db } = useIsolatedDb()

    const result = await quoteHandler({ __body: { ...quoteBody, sessionId: 'session-does-not-exist' } } as any)

    expect(result.sessionId).not.toBe('session-does-not-exist')
    expect(db.prepare('SELECT id FROM website_sessions WHERE id = ?').get(result.sessionId)).toBeTruthy()
  })

  it.each([
    ['zero weight', { weightKg: 0 }],
    ['negative weight', { weightKg: -1 }],
    ['non-numeric weight', { weightKg: 'heavy' }],
    ['zero volume', { volumeCbm: 0 }],
    ['empty destination', { destination: '' }],
    ['missing preference', { preference: undefined }]
  ])('WEB-QUOTE-VALIDATION-%s: invalid body is rejected with no new inquiry', async (_name, patch) => {
    const { db } = useIsolatedDb()
    const before = Number((db.prepare('SELECT COUNT(*) AS count FROM inquiries').get() as any).count)

    await expect(quoteHandler({ __body: { ...quoteBody, ...patch } } as any)).rejects.toBeInstanceOf(ZodError)

    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM inquiries').get() as any).count)).toBe(before)
  })
})

describe('WEBSITE-JOURNEY: identity conversion and atomic validation', () => {
  it('WEB-IDENTITY-001: fresh quote converts to customer/contact/opportunity/event and profiling task', async () => {
    const { db } = useIsolatedDb()
    const quote = await quoteHandler({ __body: quoteBody } as any)
    const selectedProductId = quote.recommendations[0].productId

    const result = await identityHandler({
      __body: {
        inquiryId: quote.inquiryId,
        email: 'buyer@fresh-acme.invalid',
        companyName: 'Fresh Acme',
        contactName: 'Alice',
        customerType: 'exporter',
        selectedProductId
      }
    } as any)
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.customerId) as any
    const contact = db.prepare('SELECT * FROM contacts WHERE customer_id = ?').get(result.customerId) as any
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(result.opportunityId) as any
    const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(quote.inquiryId) as any
    const session = db.prepare('SELECT * FROM website_sessions WHERE id = ?').get(quote.sessionId) as any
    const event = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = ? AND type = 'website_identity_captured'`).get(result.opportunityId) as any

    expect(result.ok).toBe(true)
    expect(customer).toMatchObject({ name: 'Fresh Acme', source: 'website', domain: 'fresh-acme.invalid', customer_type: 'exporter' })
    expect(contact).toMatchObject({ name: 'Alice', email_normalized: 'buyer@fresh-acme.invalid', status: 'contactable' })
    expect(opportunity).toMatchObject({ customer_id: result.customerId, product_id: selectedProductId, stage: 1, status: 'active', focus: 1 })
    expect(inquiry).toMatchObject({ customer_id: result.customerId, opportunity_id: result.opportunityId, status: 'identified' })
    expect(session.customer_id).toBe(result.customerId)
    expect(event).toBeTruthy()
    expect(result.task.task).toMatchObject({ mode: 'customer_profiling', target_id: result.customerId })
  })

  it('WEB-IDENTITY-002: normalized existing email reuses customer/contact/opportunity without duplicates', async () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE inquiries SET customer_id = '', opportunity_id = '', status = 'quoted' WHERE id = 'inquiry-seed-02'`).run()
    const beforeContacts = Number((db.prepare(`SELECT COUNT(*) AS count FROM contacts WHERE email_normalized = 'history@example.com'`).get() as any).count)
    const beforeVersion = Number((db.prepare(`SELECT profile_version FROM customers WHERE id = 'customer-web-01'`).get() as any).profile_version)

    const result = await identityHandler({
      __body: {
        inquiryId: 'inquiry-seed-02',
        email: 'history@example.com',
        selectedProductId: 'product-sim008'
      }
    } as any)

    expect(result.customerId).toBe('customer-web-01')
    expect(result.opportunityId).toBe('opp-03')
    expect(Number((db.prepare(`SELECT COUNT(*) AS count FROM contacts WHERE email_normalized = 'history@example.com'`).get() as any).count)).toBe(beforeContacts)
    expect(Number((db.prepare(`SELECT profile_version FROM customers WHERE id = 'customer-web-01'`).get() as any).profile_version)).toBe(beforeVersion + 1)
  })

  it.each([
    ['unknown product', 'product-does-not-exist'],
    ['unpublished product', 'product-by004'],
    ['published but not recommended product', 'product-sim012']
  ])('WEB-IDENTITY-003-%s: invalid selection rejects before any customer/contact writes', async (_name, selectedProductId) => {
    const { db } = useIsolatedDb()
    const quote = await quoteHandler({ __body: quoteBody } as any)
    const beforeCustomers = Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)
    const beforeContacts = Number((db.prepare('SELECT COUNT(*) AS count FROM contacts').get() as any).count)

    await expect(identityHandler({
      __body: {
        inquiryId: quote.inquiryId,
        email: 'should-not-persist@invalid-product.invalid',
        companyName: 'Must Roll Back',
        selectedProductId
      }
    } as any)).rejects.toMatchObject({ statusCode: 400 })

    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)).toBe(beforeCustomers)
    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM contacts').get() as any).count)).toBe(beforeContacts)
    expect(db.prepare(`SELECT id FROM contacts WHERE email_normalized = 'should-not-persist@invalid-product.invalid'`).get()).toBeUndefined()
  })

  it('WEB-IDENTITY-004: a legacy inquiry recommendation that became unpublished is rejected atomically', async () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE inquiries SET recommendations_json = ?, customer_id = '', opportunity_id = '', status = 'quoted'
      WHERE id = 'inquiry-seed-02'`).run(JSON.stringify([{ productId: 'product-by004', fit: 99 }]))
    const beforeCustomers = Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)

    await expect(identityHandler({
      __body: {
        inquiryId: 'inquiry-seed-02',
        email: 'legacy-unpublished@selection.invalid',
        companyName: 'Legacy Selection'
      }
    } as any)).rejects.toMatchObject({ statusCode: 400 })

    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)).toBe(beforeCustomers)
    expect(db.prepare(`SELECT id FROM contacts WHERE email_normalized = 'legacy-unpublished@selection.invalid'`).get()).toBeUndefined()
  })

  it('WEB-IDENTITY-005: unknown inquiry returns 404 without side effects', async () => {
    const { db } = useIsolatedDb()
    const beforeCustomers = Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)

    await expect(identityHandler({
      __body: { inquiryId: 'missing', email: 'buyer@missing.invalid', selectedProductId: 'product-by001' }
    } as any)).rejects.toMatchObject({ statusCode: 404 })

    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)).toBe(beforeCustomers)
  })

  it.each(['not-an-email', '', 'a@', '@example.com'])('WEB-IDENTITY-VALIDATION-%s: malformed email is rejected', async (email) => {
    useIsolatedDb()
    await expect(identityHandler({
      __body: { inquiryId: 'inquiry-seed-02', email, selectedProductId: 'product-sim008' }
    } as any)).rejects.toBeInstanceOf(ZodError)
  })
})

describe('WEBSITE-JOURNEY: rematch behavior', () => {
  it('WEB-REMATCH-001: anonymous inquiry updates quote but does not create an Agent task', async () => {
    const { db } = useIsolatedDb()
    const quote = await quoteHandler({ __body: quoteBody } as any)

    const result = await rematchHandler({
      __body: { ...quoteBody, inquiryId: quote.inquiryId, destination: '东京', details: { tradeTerm: 'CIF' } }
    } as any)
    const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(quote.inquiryId) as any

    expect(result.ok).toBe(true)
    expect(result.task).toBeNull()
    expect(inquiry).toMatchObject({ destination: '东京', status: 'quoted' })
    expect(JSON.parse(inquiry.details_json)).toEqual({ tradeTerm: 'CIF' })
  })

  it('WEB-REMATCH-002: identified customer is versioned, marked for review, audited, and queued', async () => {
    const { db } = useIsolatedDb()
    const beforeVersion = Number((db.prepare(`SELECT profile_version FROM customers WHERE id = 'customer-web-01'`).get() as any).profile_version)

    const result = await rematchHandler({
      __body: { ...quoteBody, inquiryId: 'inquiry-seed-01', destination: '纽约' }
    } as any)

    const customer = db.prepare(`SELECT * FROM customers WHERE id = 'customer-web-01'`).get() as any
    const event = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-03' AND type = 'inquiry_modified' ORDER BY created_at DESC LIMIT 1`).get() as any
    expect(customer.profile_version).toBe(beforeVersion + 1)
    expect(customer.ai_profile_status).toBe('pending')
    expect(Number((db.prepare(`SELECT stale_review FROM opportunities WHERE id = 'opp-03'`).get() as any).stale_review)).toBe(1)
    expect(event).toBeTruthy()
    expect(result.task).not.toBeNull()
    expect(result.task!.task).toMatchObject({ mode: 'product_matching', target_id: 'customer-web-01' })
  })

  it('WEB-REMATCH-003: unknown inquiry returns 404', async () => {
    useIsolatedDb()
    await expect(rematchHandler({ __body: { ...quoteBody, inquiryId: 'missing' } } as any))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('WEB-REMATCH-004: SQL-like text is stored as data and cannot mutate the products table', async () => {
    const { db } = useIsolatedDb()
    const quote = await quoteHandler({ __body: quoteBody } as any)
    const productCount = Number((db.prepare('SELECT COUNT(*) AS count FROM products').get() as any).count)
    const malicious = `深圳'); DROP TABLE products; --`

    await rematchHandler({
      __body: { ...quoteBody, inquiryId: quote.inquiryId, origin: malicious }
    } as any)

    expect((db.prepare('SELECT origin FROM inquiries WHERE id = ?').get(quote.inquiryId) as any).origin).toBe(malicious)
    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM products').get() as any).count)).toBe(productCount)
  })
})
