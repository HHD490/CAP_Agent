import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import {
  createAgentTask,
  getAgentSchemas,
  runAgentTaskNow,
  setAgentProviderForTests
} from '../../server/utils/agent'

/**
 * Decision (plan M-04 / Option A):
 * RecommendedProduct = { product_code: string | null, product_name: string, source: 'provider_object' | 'legacy_string' }
 * - Provider object requires non-empty code+name → source provider_object
 * - Legacy non-empty string → product_code null, source legacy_string
 * - Empty string / missing fields / empty object rejected
 */

function baseHandoff(recommendedProduct: unknown) {
  return {
    summary: '客户已表达明确合作意向，可分配负责人跟进。',
    customer_need: '需要稳定的美东空派运力与合作报价',
    recommended_product: recommendedProduct,
    evidence: ['客户要求本周产品说明会', '匹配产品为美东大客户空派专线'],
    risks: ['价格敏感'],
    next_steps: ['分配负责人', '准备舱位说明']
  }
}

describe('HANDOFF-LEGACY: recommended_product Option A contract', () => {
  it('HANDOFF-LEGACY-001: structured object is stored with source=provider_object', async () => {
    const { db } = useIsolatedDb()
    const input = { product_code: 'BY002', product_name: '美东大客户空派专线' }
    const parsed = getAgentSchemas().handoff_summary.parse(baseHandoff(input))
    expect(parsed.recommended_product).toEqual({
      product_code: 'BY002',
      product_name: '美东大客户空派专线',
      source: 'provider_object'
    })

    setAgentProviderForTests(async () => baseHandoff(input))
    const { task } = createAgentTask('handoff_summary', 'opportunity', 'opp-02', {})
    await runAgentTaskNow(task.id)
    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const event = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-02' AND type = 'handoff_summary' ORDER BY rowid DESC LIMIT 1`).get() as any
    expect(taskRow.status).toBe('completed')
    const result = JSON.parse(taskRow.result_json)
    const data = JSON.parse(event.data_json)
    expect(result.recommended_product).toEqual({
      product_code: 'BY002',
      product_name: '美东大客户空派专线',
      source: 'provider_object'
    })
    expect(data.recommended_product).toEqual(result.recommended_product)
  })

  it('HANDOFF-LEGACY-002: legacy string maps to product_code null + source legacy_string', async () => {
    const { db } = useIsolatedDb()
    const expected = {
      product_code: null,
      product_name: '美东大客户空派专线',
      source: 'legacy_string'
    }
    expect(getAgentSchemas().handoff_summary.parse(baseHandoff('美东大客户空派专线')).recommended_product).toEqual(expected)

    setAgentProviderForTests(async () => baseHandoff('美东大客户空派专线'))
    const { task } = createAgentTask('handoff_summary', 'opportunity', 'opp-02', {})
    await runAgentTaskNow(task.id)
    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const event = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-02' AND type = 'handoff_summary' ORDER BY rowid DESC LIMIT 1`).get() as any
    expect(taskRow.status).toBe('completed')
    const result = JSON.parse(taskRow.result_json)
    expect(result.recommended_product).toEqual(expected)
    expect(JSON.parse(event.data_json).recommended_product).toEqual(expected)
    expect(result.recommended_product.product_code).toBeNull()
  })

  it('HANDOFF-LEGACY-003: missing fields / empty object / empty string are rejected', async () => {
    const { db } = useIsolatedDb()
    const invalids = [
      { product_name: '美东大客户空派专线' },
      { product_code: 'BY002' },
      {},
      '',
      { product_code: '', product_name: 'x' },
      { product_code: 'BY002', product_name: '' }
    ]
    for (const bad of invalids) {
      const beforeEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE opportunity_id = 'opp-02' AND type = 'handoff_summary'`).get() as any).c)
      setAgentProviderForTests(async () => baseHandoff(bad))
      const { task } = createAgentTask('handoff_summary', 'opportunity', 'opp-02', {})
      await runAgentTaskNow(task.id)
      const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
      const afterEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE opportunity_id = 'opp-02' AND type = 'handoff_summary'`).get() as any).c)
      expect(taskRow.status, JSON.stringify(bad)).toBe('failed')
      expect(afterEvents, JSON.stringify(bad)).toBe(beforeEvents)
    }
  })

  it('HANDOFF-LEGACY-004: result_json and event use the same recommended_product shape (never mixed string/pseudo-empty-code)', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => baseHandoff('美东大客户空派专线'))
    const { task } = createAgentTask('handoff_summary', 'opportunity', 'opp-02', {})
    await runAgentTaskNow(task.id)
    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const event = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-02' AND type = 'handoff_summary' ORDER BY rowid DESC LIMIT 1`).get() as any
    const result = JSON.parse(taskRow.result_json).recommended_product
    const data = JSON.parse(event.data_json).recommended_product
    expect(typeof result).toBe('object')
    expect(typeof data).toBe('object')
    expect(result).toEqual(data)
    expect(result).not.toHaveProperty('product_code', '')
    expect(result.source).toBe('legacy_string')
  })
})
