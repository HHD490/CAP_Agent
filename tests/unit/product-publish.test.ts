import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import {
  buildTargetContext,
  createAgentTask,
  runAgentTaskNow,
  setAgentProviderForTests
} from '../../server/utils/agent'

describe('PRODUCT-PUBLISH: BY004 must not be treated as published', () => {
  it('PRODUCT-PUBLISH-001: BY004 seed has quote_ready=0, published=0, and PMS snapshot published=false', () => {
    const { db } = useIsolatedDb()
    const row = db.prepare('SELECT code, quote_ready, published, pms_snapshot_json FROM products WHERE code = ?').get('BY004') as any
    expect(row, 'BY004 product row must exist after seed').toBeTruthy()

    // Contract requires distinguishing the two fields — both must be asserted.
    expect(Number(row.quote_ready), 'BY004.quote_ready must be 0').toBe(0)
    expect(Number(row.published), 'BY004.published must be 0').toBe(0)

    const snapshot = JSON.parse(row.pms_snapshot_json || '{}')
    expect(snapshot.published, 'pms_snapshot_json.published must be false').toBe(false)
  })

  it('PRODUCT-PUBLISH-002: product matching context excludes BY004 but still includes published products', () => {
    const { db } = useIsolatedDb()
    const customer = db.prepare('SELECT id FROM customers LIMIT 1').get() as any
    expect(customer).toBeTruthy()

    const context = buildTargetContext('product_matching', customer.id) as any
    const codes = (context.products || []).map((p: any) => p.code)

    expect(codes.includes('BY004'), 'matching context must not include unpublished BY004').toBe(false)
    expect(codes.length, 'matching context must still include at least one published product').toBeGreaterThan(0)
    expect(codes.some((code: string) => code !== 'BY004')).toBe(true)
  })

  it('PRODUCT-PUBLISH-003: Provider returning only BY004 must not write match_results or mark effective matching complete', async () => {
    const { db } = useIsolatedDb()
    const customerId = 'customer-wca-10'
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId) as any
    expect(customer, 'seed customer-wca-10 must exist').toBeTruthy()

    const beforeMatches = db.prepare('SELECT COUNT(*) AS c FROM match_results WHERE customer_id = ?').get(customerId) as any
    const beforeStage = db.prepare(`SELECT stage FROM opportunities WHERE customer_id = ? AND status = 'active' LIMIT 1`).get(customerId) as any
    const beforeEvents = db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE customer_id = ? AND type = 'matching_completed'`).get(customerId) as any

    setAgentProviderForTests(async () => ({
      matches: [{
        product_code: 'BY004',
        fit_score: 99,
        confidence: 'high',
        evidence: ['Provider overreach: unpublished product'],
        risks: [],
        missing_information: [],
        hard_blockers: []
      }]
    }))

    const { task } = createAgentTask('product_matching', 'customer', customerId, { test: 'PRODUCT-PUBLISH-003' })
    await runAgentTaskNow(task.id)

    const after = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const by004Matches = db.prepare(`
      SELECT mr.* FROM match_results mr
      JOIN products p ON p.id = mr.product_id
      WHERE mr.customer_id = ? AND p.code = 'BY004'
    `).all(customerId) as any[]
    expect(by004Matches, 'match_results must not contain BY004').toHaveLength(0)

    const afterMatches = db.prepare('SELECT COUNT(*) AS c FROM match_results WHERE customer_id = ?').get(customerId) as any
    expect(Number(afterMatches.c), 'no new match_results should be written for unpublished-only candidates').toBe(Number(beforeMatches.c))

    // When every candidate is unpublished, do not pretend matching succeeded.
    expect(after.status, 'task must not complete as a successful effective match').not.toBe('completed')
    const afterEvents = db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE customer_id = ? AND type = 'matching_completed'`).get(customerId) as any
    expect(Number(afterEvents.c), 'must not emit matching_completed when nothing valid was written').toBe(Number(beforeEvents.c))

    if (beforeStage) {
      const afterStage = db.prepare(`SELECT stage FROM opportunities WHERE customer_id = ? AND status = 'active' LIMIT 1`).get(customerId) as any
      expect(Number(afterStage.stage), 'opportunity stage must not advance on unpublished-only matches').toBe(Number(beforeStage.stage))
    }
  })
})
