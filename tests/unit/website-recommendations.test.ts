import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import { recommendProducts } from '../../server/utils/website'

type ProductInput = {
  id: string
  code?: string
  name?: string
  transportMode?: string
  routes?: string[]
  cargoTypes?: string[]
  capabilities?: string[]
  quoteReady?: number
  published?: number
}

function insertProduct(db: any, input: ProductInput) {
  db.prepare(`INSERT INTO products
    (id, code, name, category, transport_mode, routes_json, cargo_types_json, capabilities_json,
     quote_ready, reference_price, transit_time, published, product_version, pms_snapshot_json,
     marketing_json, simulated, updated_at)
    VALUES (?, ?, ?, 'test', ?, ?, ?, ?, ?, 'TEST PRICE', 'TEST ETA', ?, 1, '{}', '{}', 0, ?)`)
    .run(
      input.id,
      input.code || input.id.toUpperCase(),
      input.name || input.id,
      input.transportMode || '空运',
      JSON.stringify(input.routes || []),
      JSON.stringify(input.cargoTypes || []),
      JSON.stringify(input.capabilities || []),
      input.quoteReady ?? 1,
      input.published ?? 1,
      '2026-07-17T02:00:00.000Z'
    )
}

const baseInput = {
  origin: '深圳',
  destination: '洛杉矶',
  cargoName: '普通服装',
  weightKg: 100,
  volumeCbm: 1,
  preference: '平衡价格与时效'
}

describe('WEBSITE-RECOMMEND: deterministic recommendation rules', () => {
  it('WEB-REC-001: only published products are returned, sorted by score, capped at Top 3', () => {
    const { db } = useIsolatedDb(false)
    insertProduct(db, { id: 'p-route', routes: ['中国-美国'] })
    insertProduct(db, { id: 'p-cargo', cargoTypes: ['服装'] })
    insertProduct(db, { id: 'p-base-1' })
    insertProduct(db, { id: 'p-base-2' })
    insertProduct(db, { id: 'p-hidden', routes: ['中国-美国'], published: 0 })

    const result = recommendProducts(baseInput)

    expect(result).toHaveLength(3)
    expect(result.map(item => item.productId)).toEqual(['p-route', 'p-cargo', 'p-base-1'])
    expect(result.some(item => item.productId === 'p-hidden')).toBe(false)
    expect(result.map(item => item.score)).toEqual([80, 64, 52])
  })

  it('WEB-REC-002: Chinese destination city is normalized to its country for route matching', () => {
    const { db } = useIsolatedDb(false)
    insertProduct(db, { id: 'p-us', routes: ['中国-美国'] })
    insertProduct(db, { id: 'p-eu', routes: ['中国-德国'] })

    const result = recommendProducts(baseInput)

    expect(result[0]).toMatchObject({ productId: 'p-us', score: 80 })
    expect(result[0]?.evidence.join(' ')).toContain('洛杉矶（美国）')
    expect(result[1]).toMatchObject({ productId: 'p-eu', score: 52 })
  })

  it('WEB-REC-003: cargo and battery capability bonuses accumulate and score is capped at 98', () => {
    const { db } = useIsolatedDb(false)
    insertProduct(db, {
      id: 'p-battery',
      routes: ['中国-美国'],
      cargoTypes: ['蓝牙音箱'],
      capabilities: ['可承接带电货物']
    })

    const [result] = recommendProducts({ ...baseInput, cargoName: '蓝牙音箱（带电）' })

    expect(result).toMatchObject({ productId: 'p-battery', score: 98 })
    expect(result?.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('美国'),
      expect.stringContaining('蓝牙音箱'),
      '具备带电货物承接能力'
    ]))
  })

  it('WEB-REC-004: time, sea-volume, and large-shipment bonuses follow their boundaries', () => {
    const { db } = useIsolatedDb(false)
    insertProduct(db, { id: 'p-fast', name: '美国特快线' })
    insertProduct(db, { id: 'p-sea', name: '海运基础线', transportMode: '海运拼箱' })
    insertProduct(db, { id: 'p-large', name: '大客户大票线' })

    const result = recommendProducts({
      ...baseInput,
      preference: '优先时效',
      volumeCbm: 3,
      weightKg: 500
    })
    const scoreById = Object.fromEntries(result.map(item => [item.productId, item.score]))

    expect(scoreById).toEqual({ 'p-sea': 60, 'p-large': 59, 'p-fast': 58 })
  })

  it('WEB-REC-005: unmatched product exposes stable fallback evidence and quote metadata', () => {
    const { db } = useIsolatedDb(false)
    insertProduct(db, { id: 'p-basic', quoteReady: 0, capabilities: ['报关'] })

    const [result] = recommendProducts(baseInput)

    expect(result).toMatchObject({
      productId: 'p-basic',
      code: 'P-BASIC',
      score: 52,
      evidence: ['已发布产品，可进一步人工询价确认'],
      capabilities: ['报关'],
      quoteReady: false,
      referencePrice: 'TEST PRICE',
      transitTime: 'TEST ETA'
    })
  })
})
