import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach } from 'vitest'
import {
  initializeDatabaseConnection,
  prepareOpenedDatabase,
  resetDemoDatabase,
  setDbForTests
} from '../../server/utils/db'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
  setDbForTests(undefined)
})

function openTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'cap-legacy-'))
  const path = join(dir, 'legacy.sqlite')
  const db = new DatabaseSync(path)
  cleanups.push(() => {
    try { db.close() } catch { /* */ }
    setDbForTests(undefined)
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* */ }
  })
  return { db, path, dir }
}

/** Build a pre-existing DB that already has demo_state (so seed/reset will NOT run). */
function buildLegacyDbWithBadBy004() {
  const { db } = openTempDb()
  initializeDatabaseConnection(db) // schema only, no seed
  const now = '2026-07-17T02:00:00.000Z'
  db.prepare('INSERT INTO demo_state (id, current_time) VALUES (1, ?)').run(now)

  // Non-BY004 published product that must remain untouched.
  db.prepare(`INSERT INTO products
    (id, code, name, category, transport_mode, routes_json, cargo_types_json, capabilities_json, quote_ready,
     reference_price, transit_time, published, product_version, pms_snapshot_json, marketing_json, simulated, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      'product-by001', 'BY001', '美国空派标快（含税）', '空运', '空派专线',
      JSON.stringify(['中国-美国']), JSON.stringify(['普货']), JSON.stringify(['DDP']),
      1, '¥ 42/KG', '8–10 日', 1, 3,
      JSON.stringify({ code: 'BY001', name: '美国空派标快（含税）', published: true, marker: 'keep-me' }),
      JSON.stringify({ headline: 'keep-marketing', sellingPoints: ['DDP'] }),
      0, now
    )

  // Legacy buggy BY004: published=1 and snapshot published=true
  db.prepare(`INSERT INTO products
    (id, code, name, category, transport_mode, routes_json, cargo_types_json, capabilities_json, quote_ready,
     reference_price, transit_time, published, product_version, pms_snapshot_json, marketing_json, simulated, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      'product-by004', 'BY004', '美国空派中技全链路', '空运', '空派专线',
      JSON.stringify(['中国-美国']), JSON.stringify(['普货']), JSON.stringify(['上门提货']),
      0, '需人工询价', '7–10 日', 1, 1,
      JSON.stringify({ code: 'BY004', name: '美国空派中技全链路', published: true, source: 'PMS 原型快照' }),
      JSON.stringify({ headline: 'by004-marketing' }),
      0, now
    )

  db.prepare(`INSERT INTO customers
    (id, name, source, source_ref, country, city, website, domain, customer_type, status, profile_version,
     raw_json, facts_json, ai_profile_json, ai_profile_status, last_activity_at, created_at, updated_at)
    VALUES (?, ?, 'website', 'LEGACY-1', '中国', '宁波', '', 'legacy.example', 'direct_shipper', 'normal', 1,
     '{}', '{}', '{}', 'pending', ?, ?, ?)`)
    .run('customer-legacy-01', '遗留客户', now, now, now)

  db.prepare(`INSERT INTO opportunities
    (id, customer_id, product_id, contact_id, source, stage, status, focus, owner, next_action, due_at, blocker, stale_review,
     close_reason, ai_summary, created_at, updated_at)
    VALUES (?, ?, ?, '', 'passive', 4, 'active', 1, '', '补充联系人', '', '缺少联系人', 0, '', '', ?, ?)`)
    .run('opp-legacy-01', 'customer-legacy-01', 'product-by004', now, now)

  db.prepare(`INSERT INTO match_results
    (id, customer_id, product_id, score, confidence, evidence_json, risks_json, missing_json, blockers_json,
     customer_version, product_version, stale, status, created_at, updated_at)
    VALUES (?, ?, ?, 90, 'high', '[]', '[]', '[]', '[]', 1, 1, 0, 'accepted', ?, ?)`)
    .run('match-legacy-01', 'customer-legacy-01', 'product-by004', now, now)

  db.prepare(`INSERT INTO opportunity_events
    (id, opportunity_id, customer_id, type, title, description, source, data_json, created_at)
    VALUES (?, ?, ?, 'match_accepted', '历史事件', '保留', 'human', '{}', ?)`)
    .run('event-legacy-01', 'opp-legacy-01', 'customer-legacy-01', now)

  return db
}

describe('LEGACY-PUBLISH: existing DBs must migrate BY004 unpublished', () => {
  it('LEGACY-PUBLISH-001: opening a legacy DB with demo_state fixes BY004 without wiping business rows', () => {
    const db = buildLegacyDbWithBadBy004()
    const beforeCustomers = Number((db.prepare(`SELECT COUNT(*) AS c FROM customers`).get() as any).c)
    const beforeOpps = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunities`).get() as any).c)
    const beforeMatches = Number((db.prepare(`SELECT COUNT(*) AS c FROM match_results`).get() as any).c)
    const beforeEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events`).get() as any).c)

    // Official init path for an already-opened connection (must NOT resetDemoDatabase).
    prepareOpenedDatabase(db)
    setDbForTests(db)

    const by004 = db.prepare(`SELECT quote_ready, published, pms_snapshot_json FROM products WHERE code = 'BY004'`).get() as any
    expect(Number(by004.quote_ready)).toBe(0)
    expect(Number(by004.published), 'legacy BY004.published must become 0').toBe(0)
    expect(JSON.parse(by004.pms_snapshot_json).published).toBe(false)

    expect(Number((db.prepare(`SELECT COUNT(*) AS c FROM customers`).get() as any).c)).toBe(beforeCustomers)
    expect(Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunities`).get() as any).c)).toBe(beforeOpps)
    expect(Number((db.prepare(`SELECT COUNT(*) AS c FROM match_results`).get() as any).c)).toBe(beforeMatches)
    expect(Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events`).get() as any).c)).toBe(beforeEvents)
    expect(db.prepare(`SELECT id FROM customers WHERE id = 'customer-legacy-01'`).get()).toBeTruthy()
    expect(db.prepare(`SELECT id FROM opportunity_events WHERE id = 'event-legacy-01'`).get()).toBeTruthy()
  })

  it('LEGACY-PUBLISH-002: re-running prepare is idempotent with no duplicate migration side effects', () => {
    const db = buildLegacyDbWithBadBy004()
    prepareOpenedDatabase(db)
    const afterFirst = db.prepare(`SELECT published, pms_snapshot_json, product_version FROM products WHERE code = 'BY004'`).get() as any
    const migrationCount1 = Number((db.prepare(`SELECT COUNT(*) AS c FROM schema_migrations`).get() as any).c)
    const eventCount1 = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events`).get() as any).c)

    prepareOpenedDatabase(db)
    const afterSecond = db.prepare(`SELECT published, pms_snapshot_json, product_version FROM products WHERE code = 'BY004'`).get() as any
    const migrationCount2 = Number((db.prepare(`SELECT COUNT(*) AS c FROM schema_migrations`).get() as any).c)
    const eventCount2 = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events`).get() as any).c)

    expect(Number(afterSecond.published)).toBe(0)
    expect(JSON.parse(afterSecond.pms_snapshot_json).published).toBe(false)
    expect(Number(afterSecond.product_version)).toBe(Number(afterFirst.product_version))
    expect(migrationCount2).toBe(migrationCount1)
    expect(eventCount2).toBe(eventCount1)
  })

  it('LEGACY-PUBLISH-003: non-BY004 products keep published/quote_ready/version/marketing/snapshot', () => {
    const db = buildLegacyDbWithBadBy004()
    const before = db.prepare(`SELECT * FROM products WHERE code = 'BY001'`).get() as any
    prepareOpenedDatabase(db)
    const after = db.prepare(`SELECT * FROM products WHERE code = 'BY001'`).get() as any

    expect(Number(after.published)).toBe(Number(before.published))
    expect(Number(after.quote_ready)).toBe(Number(before.quote_ready))
    expect(Number(after.product_version)).toBe(Number(before.product_version))
    expect(after.marketing_json).toBe(before.marketing_json)
    expect(after.pms_snapshot_json).toBe(before.pms_snapshot_json)
  })

  it('LEGACY-PUBLISH-004: fresh DB without demo_state still seeds BY004 unpublished', () => {
    const { db } = openTempDb()
    initializeDatabaseConnection(db)
    prepareOpenedDatabase(db) // no demo_state → seed path
    setDbForTests(db)

    const by004 = db.prepare(`SELECT quote_ready, published, pms_snapshot_json FROM products WHERE code = 'BY004'`).get() as any
    expect(by004).toBeTruthy()
    expect(Number(by004.quote_ready)).toBe(0)
    expect(Number(by004.published)).toBe(0)
    expect(JSON.parse(by004.pms_snapshot_json).published).toBe(false)
  })

  it('LEGACY-PUBLISH-005: migration is safe when BY004 product row is missing', () => {
    const { db } = openTempDb()
    initializeDatabaseConnection(db)
    const now = '2026-07-17T02:00:00.000Z'
    db.prepare('INSERT INTO demo_state (id, current_time) VALUES (1, ?)').run(now)
    db.prepare(`INSERT INTO products
      (id, code, name, category, transport_mode, routes_json, cargo_types_json, capabilities_json, quote_ready,
       reference_price, transit_time, published, product_version, pms_snapshot_json, marketing_json, simulated, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'product-by001', 'BY001', '美国空派标快（含税）', '空运', '空派专线',
        '[]', '[]', '[]', 1, 'x', 'y', 1, 1,
        JSON.stringify({ code: 'BY001', published: true }),
        '{}', 0, now
      )

    expect(() => prepareOpenedDatabase(db)).not.toThrow()
    expect(db.prepare(`SELECT id FROM products WHERE code = 'BY004'`).get()).toBeFalsy()
    expect(Number((db.prepare(`SELECT COUNT(*) AS c FROM schema_migrations WHERE id = 'by004_unpublish_v1'`).get() as any).c)).toBe(1)
    const by001 = db.prepare(`SELECT published FROM products WHERE code = 'BY001'`).get() as any
    expect(Number(by001.published)).toBe(1)
  })

  it('LEGACY-PUBLISH-006: already-correct BY004 is left unchanged and migration still marks applied', () => {
    const { db } = openTempDb()
    initializeDatabaseConnection(db)
    const now = '2026-07-17T02:00:00.000Z'
    db.prepare('INSERT INTO demo_state (id, current_time) VALUES (1, ?)').run(now)
    db.prepare(`INSERT INTO products
      (id, code, name, category, transport_mode, routes_json, cargo_types_json, capabilities_json, quote_ready,
       reference_price, transit_time, published, product_version, pms_snapshot_json, marketing_json, simulated, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'product-by004', 'BY004', '美国空派中技全链路', '空运', '空派专线',
        '[]', '[]', '[]', 0, '需人工询价', '7–10', 0, 2,
        JSON.stringify({ code: 'BY004', published: false, marker: 'already-good' }),
        JSON.stringify({ headline: 'keep' }), 0, now
      )

    prepareOpenedDatabase(db)
    const after = db.prepare(`SELECT published, product_version, pms_snapshot_json, marketing_json FROM products WHERE code = 'BY004'`).get() as any
    expect(Number(after.published)).toBe(0)
    expect(Number(after.product_version)).toBe(2)
    expect(JSON.parse(after.pms_snapshot_json)).toEqual({ code: 'BY004', published: false, marker: 'already-good' })
    expect(after.marketing_json).toBe(JSON.stringify({ headline: 'keep' }))
    expect(Number((db.prepare(`SELECT COUNT(*) AS c FROM schema_migrations WHERE id = 'by004_unpublish_v1'`).get() as any).c)).toBe(1)
  })
})
