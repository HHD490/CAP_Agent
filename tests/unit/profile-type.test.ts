import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import {
  createAgentTask,
  getAgentSchemas,
  runAgentTaskNow,
  setAgentProviderForTests
} from '../../server/utils/agent'

const LEGAL_TYPES = [
  'freight_forwarder_partner',
  'ecommerce_seller',
  'exporter',
  'trading_company',
  'direct_shipper',
  'unknown'
] as const

function baseProfile(customerType: unknown) {
  return {
    customer_type: customerType,
    summary: '测试客户画像摘要',
    likely_needs: ['中国出口运力'],
    capabilities: ['清关'],
    target_lanes: ['中国-美国'],
    confidence: 'high',
    evidence: ['公司服务范围'],
    missing_information: [],
    suggested_next_action: '进入产品匹配'
  }
}

describe('PROFILE-TYPE: customer_type must use business enum', () => {
  it('PROFILE-TYPE-001: all six legal values pass schema and persist', async () => {
    const { db } = useIsolatedDb()
    const schema = getAgentSchemas().customer_profiling

    for (const customerType of LEGAL_TYPES) {
      expect(() => schema.parse(baseProfile(customerType))).not.toThrow()
    }

    // Persist each value on distinct customers to avoid cross-talk.
    const customers = db.prepare(`SELECT id FROM customers WHERE source = 'wca_simulated' ORDER BY id LIMIT 6`).all() as any[]
    expect(customers.length).toBe(6)

    for (let i = 0; i < LEGAL_TYPES.length; i++) {
      const customerType = LEGAL_TYPES[i]!
      const customerId = customers[i]!.id
      setAgentProviderForTests(async () => baseProfile(customerType))
      const { task } = createAgentTask('customer_profiling', 'customer', customerId, { autoMatch: false })
      await runAgentTaskNow(task.id)
      const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
      const customer = db.prepare('SELECT customer_type, ai_profile_json, ai_profile_status FROM customers WHERE id = ?').get(customerId) as any
      expect(taskRow.status, customerType).toBe('completed')
      expect(customer.customer_type).toBe(customerType)
      expect(customer.ai_profile_status).toBe('suggested')
      expect(JSON.parse(customer.ai_profile_json).customerType).toBe(customerType)
    }
  })

  it('PROFILE-TYPE-002: high_value_partner is rejected with no profile writes or events', async () => {
    const { db } = useIsolatedDb()
    const customerId = 'customer-wca-20'
    const before = db.prepare('SELECT customer_type, ai_profile_json, ai_profile_status FROM customers WHERE id = ?').get(customerId) as any
    const beforeEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE customer_id = ? AND type = 'profile_completed'`).get(customerId) as any).c)
    const beforeMatchTasks = Number((db.prepare(`SELECT COUNT(*) AS c FROM agent_tasks WHERE mode = 'product_matching' AND target_id = ?`).get(customerId) as any).c)

    setAgentProviderForTests(async () => baseProfile('high_value_partner'))
    const { task } = createAgentTask('customer_profiling', 'customer', customerId, { autoMatch: true })
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const after = db.prepare('SELECT customer_type, ai_profile_json, ai_profile_status FROM customers WHERE id = ?').get(customerId) as any
    const afterEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE customer_id = ? AND type = 'profile_completed'`).get(customerId) as any).c)
    const afterMatchTasks = Number((db.prepare(`SELECT COUNT(*) AS c FROM agent_tasks WHERE mode = 'product_matching' AND target_id = ?`).get(customerId) as any).c)

    expect(taskRow.status).toBe('failed')
    expect(after.customer_type).toBe(before.customer_type)
    expect(after.ai_profile_json).toBe(before.ai_profile_json)
    expect(after.ai_profile_status).toBe(before.ai_profile_status)
    expect(afterEvents).toBe(beforeEvents)
    expect(afterMatchTasks).toBe(beforeMatchTasks)
  })

  it('PROFILE-TYPE-003: empty string, case variant, number, and null are rejected without writes', async () => {
    const { db } = useIsolatedDb()
    const invalids = ['', 'Freight_Forwarder_Partner', 42, null]
    const customers = db.prepare(`SELECT id FROM customers WHERE source = 'wca_simulated' ORDER BY id DESC LIMIT 4`).all() as any[]

    for (let i = 0; i < invalids.length; i++) {
      const customerId = customers[i]!.id
      const before = db.prepare('SELECT customer_type, ai_profile_json, ai_profile_status FROM customers WHERE id = ?').get(customerId) as any
      const beforeEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE customer_id = ? AND type = 'profile_completed'`).get(customerId) as any).c)

      setAgentProviderForTests(async () => baseProfile(invalids[i]))
      const { task } = createAgentTask('customer_profiling', 'customer', customerId, { autoMatch: false })
      await runAgentTaskNow(task.id)

      const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
      const after = db.prepare('SELECT customer_type, ai_profile_json, ai_profile_status FROM customers WHERE id = ?').get(customerId) as any
      const afterEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE customer_id = ? AND type = 'profile_completed'`).get(customerId) as any).c)

      expect(taskRow.status, String(invalids[i])).toBe('failed')
      expect(after.customer_type).toBe(before.customer_type)
      expect(after.ai_profile_json).toBe(before.ai_profile_json)
      expect(after.ai_profile_status).toBe(before.ai_profile_status)
      expect(afterEvents).toBe(beforeEvents)
    }
  })

  it('PROFILE-TYPE-004: legal profile still advances opportunity and can trigger product matching', async () => {
    const { db } = useIsolatedDb()
    const customerId = 'customer-wca-15'
    // Ensure an active opportunity with stage < 2 exists for advancement assertion.
    const now = '2026-07-17T02:00:00.000Z'
    const oppId = 'opp-profile-type-004'
    db.prepare(`INSERT INTO opportunities
      (id, customer_id, product_id, contact_id, source, stage, status, focus, owner, next_action, due_at, blocker, stale_review,
       close_reason, ai_summary, created_at, updated_at)
      VALUES (?, ?, 'product-by001', '', 'active', 1, 'active', 0, '', '等待画像', '', '', 0, '', '', ?, ?)`)
      .run(oppId, customerId, now, now)

    setAgentProviderForTests(async (mode) => {
      if (mode === 'customer_profiling') return baseProfile('trading_company')
      return {
        matches: [{
          product_code: 'BY001',
          fit_score: 88,
          confidence: 'high',
          evidence: ['美国方向'],
          risks: [],
          missing_information: [],
          hard_blockers: []
        }]
      }
    })

    const { task } = createAgentTask('customer_profiling', 'customer', customerId, { autoMatch: true })
    await runAgentTaskNow(task.id)

    const profileTask = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(profileTask.status).toBe('completed')

    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as any
    expect(Number(opp.stage)).toBeGreaterThanOrEqual(2)

    const matchTask = db.prepare(`SELECT * FROM agent_tasks WHERE mode = 'product_matching' AND target_id = ? ORDER BY created_at DESC LIMIT 1`).get(customerId) as any
    expect(matchTask).toBeTruthy()
    await runAgentTaskNow(matchTask.id)
    const matchDone = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(matchTask.id) as any
    expect(matchDone.status).toBe('completed')
  })
})
