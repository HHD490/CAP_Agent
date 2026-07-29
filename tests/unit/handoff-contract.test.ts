import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import {
  createAgentTask,
  getAgentSchemas,
  runAgentTaskNow,
  setAgentProviderForTests
} from '../../server/utils/agent'

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

describe('HANDOFF-CONTRACT: recommended_product object/string compatibility', () => {
  it('HANDOFF-CONTRACT-001: structured object passes schema, completes task, writes handoff event', async () => {
    const { db } = useIsolatedDb()
    const product = { product_code: 'BY002', product_name: '美东大客户空派专线' }
    expect(() => getAgentSchemas().handoff_summary.parse(baseHandoff(product))).not.toThrow()

    const beforeEvents = Number((db.prepare(`SELECT COUNT(*) AS c FROM opportunity_events WHERE opportunity_id = 'opp-02' AND type = 'handoff_summary'`).get() as any).c)
    setAgentProviderForTests(async () => baseHandoff(product))
    const { task } = createAgentTask('handoff_summary', 'opportunity', 'opp-02', {})
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const events = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-02' AND type = 'handoff_summary' ORDER BY created_at DESC`).all() as any[]
    expect(taskRow.status).toBe('completed')
    expect(events.length).toBe(beforeEvents + 1)

    const result = JSON.parse(taskRow.result_json)
    expect(result.recommended_product).toEqual({
      product_code: 'BY002',
      product_name: '美东大客户空派专线',
      source: 'provider_object'
    })
  })

  it('HANDOFF-CONTRACT-002: non-empty legacy string remains compatible and completes', async () => {
    const { db } = useIsolatedDb()
    setAgentProviderForTests(async () => baseHandoff('美东大客户空派专线'))
    const { task } = createAgentTask('handoff_summary', 'opportunity', 'opp-02', {})
    await runAgentTaskNow(task.id)
    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(taskRow.status).toBe('completed')
    const result = JSON.parse(taskRow.result_json)
    // Option A: legacy string → null code + explicit source (never empty-string code).
    expect(result.recommended_product).toEqual({
      product_code: null,
      product_name: '美东大客户空派专线',
      source: 'legacy_string'
    })
  })

  it('HANDOFF-CONTRACT-003: missing fields / empty object / empty string fail without handoff event', async () => {
    const { db } = useIsolatedDb()
    const invalids = [
      { product_name: '美东大客户空派专线' },
      { product_code: 'BY002' },
      {},
      ''
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

  it('HANDOFF-CONTRACT-004: result_json and event data use the same recommended_product shape', async () => {
    const { db } = useIsolatedDb()
    const product = { product_code: 'BY002', product_name: '美东大客户空派专线' }
    setAgentProviderForTests(async () => baseHandoff(product))
    const { task } = createAgentTask('handoff_summary', 'opportunity', 'opp-02', {})
    await runAgentTaskNow(task.id)

    const taskRow = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(task.id) as any
    const event = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-02' AND type = 'handoff_summary' ORDER BY rowid DESC LIMIT 1`).get() as any
    const result = JSON.parse(taskRow.result_json)
    const data = JSON.parse(event.data_json || '{}')
    expect(result.recommended_product).toEqual({
      product_code: 'BY002',
      product_name: '美东大客户空派专线',
      source: 'provider_object'
    })
    expect(data.recommended_product).toEqual(result.recommended_product)
  })
})
