import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import resetHandler from '../../server/api/demo/reset.post'

function tableCounts(db: any) {
  const tables = [
    'customers',
    'contacts',
    'products',
    'match_results',
    'opportunities',
    'opportunity_events',
    'email_drafts',
    'agent_tasks',
    'agent_task_steps',
    'website_sessions',
    'inquiries'
  ]
  return Object.fromEntries(tables.map(table => [
    table,
    Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count)
  ]))
}

describe('DEMO-RESET: deterministic recovery endpoint', () => {
  it('DEMO-RESET-001: reset removes user mutations and restores the canonical seed', () => {
    const { db } = useIsolatedDb()
    const baseline = tableCounts(db)
    db.prepare(`INSERT INTO customers
      (id, name, source, source_ref, country, city, website, domain, customer_type, status, profile_version,
       raw_json, facts_json, ai_profile_json, ai_profile_status, last_activity_at, created_at, updated_at)
      VALUES ('temporary-customer', 'Temporary', 'manual', '', '', '', '', '', 'unknown', 'normal', 1,
       '{}', '{}', '{}', 'pending', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z', '2026-07-17T00:00:00.000Z')`).run()
    db.prepare(`UPDATE demo_state SET current_time = '2030-01-01T00:00:00.000Z' WHERE id = 1`).run()

    const result = resetHandler({} as any) as any

    expect(db.prepare(`SELECT id FROM customers WHERE id = 'temporary-customer'`).get()).toBeUndefined()
    expect(tableCounts(db)).toEqual(baseline)
    expect(result.currentTime).toBe('2026-07-17T02:00:00.000Z')
    expect(result.counts.totalCustomers).toBe(baseline.customers)
  })

  it('DEMO-RESET-002: repeated resets are idempotent and do not duplicate seed rows', () => {
    const { db } = useIsolatedDb()

    const first = resetHandler({} as any) as any
    const firstCounts = tableCounts(db)
    const second = resetHandler({} as any) as any

    expect(tableCounts(db)).toEqual(firstCounts)
    expect(second.counts).toEqual(first.counts)
    expect(Number((db.prepare(`SELECT COUNT(*) AS count FROM products WHERE code = 'BY001'`).get() as any).count)).toBe(1)
  })

  it('DEMO-RESET-003: reset preserves the BY004 unpublished safety invariant', () => {
    const { db } = useIsolatedDb()
    db.prepare(`UPDATE products SET published = 1, quote_ready = 1 WHERE code = 'BY004'`).run()

    resetHandler({} as any)

    const row = db.prepare(`SELECT published, quote_ready, pms_snapshot_json FROM products WHERE code = 'BY004'`).get() as any
    expect(Number(row.published)).toBe(0)
    expect(Number(row.quote_ready)).toBe(0)
    expect(JSON.parse(row.pms_snapshot_json).published).toBe(false)
  })
})
