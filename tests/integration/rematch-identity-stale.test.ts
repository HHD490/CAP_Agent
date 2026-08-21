import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import rematchHandler from '../../server/api/website/rematch.post'
import identityHandler from '../../server/api/website/identity.post'
import quoteHandler from '../../server/api/website/quote.post'
import { newId } from '../../server/utils/db'

function insertMatch(db: any, row: {
  id: string
  customerId: string
  productId: string
  status: string
  stale: number
  now?: string
}) {
  const now = row.now || '2026-07-17T02:00:00.000Z'
  db.prepare(`INSERT INTO match_results
    (id, customer_id, product_id, score, confidence, evidence_json, risks_json, missing_json, blockers_json,
     customer_version, product_version, stale, status, created_at, updated_at)
    VALUES (?, ?, ?, 80, 'high', '[]', '[]', '[]', '[]', 1, 1, ?, ?, ?, ?)`)
    .run(row.id, row.customerId, row.productId, row.stale, row.status, now, now)
}

function getMatch(db: any, id: string) {
  return db.prepare('SELECT * FROM match_results WHERE id = ?').get(id) as any
}

describe('REMATCH/IDENTITY: accepted matches must not become stale', () => {
  it('REMATCH-STALE-001: rematch keeps accepted stale=0 while proposed becomes stale=1', async () => {
    const { db } = useIsolatedDb()
    const customerId = 'customer-web-01'
    const inquiryId = 'inquiry-seed-01'
    db.prepare(`DELETE FROM match_results WHERE customer_id = ?`).run(customerId)
    insertMatch(db, { id: 'm-acc', customerId, productId: 'product-by001', status: 'accepted', stale: 0 })
    insertMatch(db, { id: 'm-prop', customerId, productId: 'product-by002', status: 'proposed', stale: 0 })

    await rematchHandler({
      __body: {
        inquiryId,
        origin: '深圳',
        destination: '洛杉矶',
        cargoName: '蓝牙音箱',
        weightKg: 100,
        volumeCbm: 1.2,
        preference: '平衡价格与时效',
        details: {}
      }
    } as any)

    expect(Number(getMatch(db, 'm-acc').stale)).toBe(0)
    expect(getMatch(db, 'm-acc').status).toBe('accepted')
    expect(Number(getMatch(db, 'm-prop').stale)).toBe(1)
    expect(getMatch(db, 'm-prop').status).toBe('proposed')
  })

  it('REMATCH-STALE-002: rematch does not reactivate accepted/stale=1', async () => {
    const { db } = useIsolatedDb()
    const customerId = 'customer-web-01'
    const inquiryId = 'inquiry-seed-01'
    db.prepare(`DELETE FROM match_results WHERE customer_id = ?`).run(customerId)
    insertMatch(db, { id: 'm-acc-stale', customerId, productId: 'product-by001', status: 'accepted', stale: 1 })

    await rematchHandler({
      __body: {
        inquiryId,
        origin: '深圳',
        destination: '洛杉矶',
        cargoName: '蓝牙音箱',
        weightKg: 100,
        volumeCbm: 1.2,
        preference: '平衡价格与时效'
      }
    } as any)

    const row = getMatch(db, 'm-acc-stale')
    expect(Number(row.stale)).toBe(1)
    expect(row.status).toBe('accepted')
  })

  it('IDENTITY-STALE-001: existing-customer identity path preserves accepted and stales non-accepted', async () => {
    const { db } = useIsolatedDb()
    const customerId = 'customer-web-01'
    const inquiry = db.prepare(`SELECT * FROM inquiries WHERE id = 'inquiry-seed-02'`).get() as any
    // Force inquiry to be unbound so identity path updates existing customer by email.
    db.prepare(`UPDATE inquiries SET customer_id = '', opportunity_id = '', status = 'quoted' WHERE id = ?`).run(inquiry.id)
    db.prepare(`DELETE FROM match_results WHERE customer_id = ?`).run(customerId)
    insertMatch(db, { id: 'id-acc', customerId, productId: 'product-by001', status: 'accepted', stale: 0 })
    insertMatch(db, { id: 'id-prop', customerId, productId: 'product-by003', status: 'proposed', stale: 0 })

    await identityHandler({
      __body: {
        inquiryId: inquiry.id,
        email: 'history@example.com',
        companyName: '远舟跨境贸易',
        contactName: '陈经理',
        customerType: 'ecommerce_seller',
        selectedProductId: 'product-sim008'
      }
    } as any)

    expect(Number(getMatch(db, 'id-acc').stale)).toBe(0)
    expect(getMatch(db, 'id-acc').status).toBe('accepted')
    expect(Number(getMatch(db, 'id-prop').stale)).toBe(1)
  })

  it('REMATCH-STALE-003: rematch still creates product_matching task', async () => {
    const { db } = useIsolatedDb()
    const inquiryId = 'inquiry-seed-01'
    const customerId = 'customer-web-01'
    db.prepare(`DELETE FROM match_results WHERE customer_id = ?`).run(customerId)
    insertMatch(db, { id: 'm-acc-3', customerId, productId: 'product-by001', status: 'accepted', stale: 0 })
    insertMatch(db, { id: 'm-prop-3', customerId, productId: 'product-by002', status: 'proposed', stale: 0 })
    const beforeTasks = Number((db.prepare(`SELECT COUNT(*) AS c FROM agent_tasks WHERE mode = 'product_matching' AND target_id = ?`).get(customerId) as any).c)

    const result = await rematchHandler({
      __body: {
        inquiryId,
        origin: '深圳',
        destination: '洛杉矶',
        cargoName: '蓝牙音箱',
        weightKg: 100,
        volumeCbm: 1.2,
        preference: '平衡价格与时效'
      }
    } as any)

    expect(result.ok).toBe(true)
    expect(result.task?.task || result.task).toBeTruthy()
    const afterTasks = Number((db.prepare(`SELECT COUNT(*) AS c FROM agent_tasks WHERE mode = 'product_matching' AND target_id = ?`).get(customerId) as any).c)
    expect(afterTasks).toBeGreaterThan(beforeTasks)
    expect(Number(getMatch(db, 'm-acc-3').stale)).toBe(0)
    expect(Number(getMatch(db, 'm-prop-3').stale)).toBe(1)
  })

  it('QUOTE-STALE-CHAR: quote.post does not mutate match_results stale flags (characterization)', async () => {
    const { db } = useIsolatedDb()
    const customerId = 'customer-web-01'
    // Attach a customer to a fresh inquiry path is not required; quote itself never stales.
    // Seed matches on a customer and ensure quote leaves them untouched.
    db.prepare(`DELETE FROM match_results WHERE customer_id = ?`).run(customerId)
    insertMatch(db, { id: 'q-acc', customerId, productId: 'product-by001', status: 'accepted', stale: 0 })
    insertMatch(db, { id: 'q-prop', customerId, productId: 'product-by002', status: 'proposed', stale: 0 })

    const sessionId = newId('session')
    const now = '2026-07-17T02:00:00.000Z'
    db.prepare('INSERT INTO website_sessions (id, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(sessionId, customerId, now, now)

    await quoteHandler({
      __body: {
        sessionId,
        origin: '深圳',
        destination: '纽约',
        cargoName: '普货',
        weightKg: 50,
        volumeCbm: 0.8,
        preference: '优先时效'
      }
    } as any)

    expect(Number(getMatch(db, 'q-acc').stale)).toBe(0)
    expect(Number(getMatch(db, 'q-prop').stale)).toBe(0)
    // Business note: quote does not invalidate matches today. Rematch/identity do, and must exclude accepted.
  })
})
