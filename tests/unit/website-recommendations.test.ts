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

  it('WEB-REC-006: empty products table → returns [] (no crash, no fallback)', () => {
    const { db } = useIsolatedDb(false)
    // 不插入任何 product
    const result = recommendProducts(baseInput)
    expect(result).toEqual([])
  })

  it('WEB-REC-007: no published products → returns [] (only published are visible)', () => {
    const { db } = useIsolatedDb(false)
    insertProduct(db, { id: 'p-hidden-1', routes: ['中国-美国'], published: 0 })
    insertProduct(db, { id: 'p-hidden-2', cargoTypes: ['服装'], published: 0 })
    insertProduct(db, { id: 'p-hidden-3', published: 0 })

    const result = recommendProducts(baseInput)
    expect(result).toEqual([])
  })

  it('WEB-REC-008: all 5 bonus paths stacking on one product → score capped at 98', () => {
    // 单个产品同时命中：route(28) + cargo(12) + battery(10) + time(6) + sea(8) + large(7)
    // 算术和 = 52 + 28 + 12 + 10 + 6 + 8 + 7 = 123 → 断言 Math.min(98, 123) === 98
    // evidence 合同：只有 route / cargo / battery 三档会写入 evidence；
    // time / sea / large 只加分、不写 evidence（与代码一致）。
    const { db } = useIsolatedDb(false)
    insertProduct(db, {
      id: 'p-everything',
      name: '美国特快海运大客户大票线',         // 同时满足：name 含"特快"（time） + "大客户|大票"（large）
      transportMode: '海运拼箱',                 // 含"海运"（sea 体积加分）
      routes: ['中国-美国'],
      cargoTypes: ['蓝牙音箱'],                  // cargoName='蓝牙音箱（带电）' 时命中
      capabilities: ['可承接带电货物']           // cargo 含"蓝牙/带电"时命中
    })

    const [result] = recommendProducts({
      ...baseInput,
      cargoName: '蓝牙音箱（带电）',
      preference: '优先时效',
      volumeCbm: 5,                              // >= 3 触发 sea 加分
      weightKg: 800                              // >= 500 触发 large 加分
    })

    expect(result).toMatchObject({ productId: 'p-everything', score: 98 })
    expect(result?.score).toBeLessThanOrEqual(98)
    // evidence 只来自前 3 档；锁定长度与具体文案
    expect(result?.evidence).toEqual([
      '覆盖 洛杉矶（美国）方向',
      '适配 蓝牙音箱（带电） 品类',
      '具备带电货物承接能力'
    ])
  })

  it('WEB-REC-009: destination outside cityCountryMap and no route match → only base 52', () => {
    // '火星' 不在 cityCountryMap 中，没有 'route' 能命中它
    // → 不应该 +28，只剩 base 52
    const { db } = useIsolatedDb(false)
    insertProduct(db, { id: 'p-default', routes: ['中国-日本'] })

    const [result] = recommendProducts({ ...baseInput, destination: '火星' })
    expect(result).toMatchObject({ productId: 'p-default', score: 52 })
    expect(result?.evidence).toEqual(['已发布产品，可进一步人工询价确认'])
  })

  it('WEB-REC-010: identical scores preserve insertion order (stable sort)', () => {
    // 两个产品分数完全相同（都没 route/cargo 命中 → 52）
    // 期望：保持插入顺序返回（依靠 Array.prototype.sort 的稳定特性）
    const { db } = useIsolatedDb(false)
    insertProduct(db, { id: 'p-a' })
    insertProduct(db, { id: 'p-b' })
    insertProduct(db, { id: 'p-c' })

    const result = recommendProducts({ ...baseInput, destination: '火星' })
    expect(result.map(item => item.productId)).toEqual(['p-a', 'p-b', 'p-c'])
    expect(result.every(item => item.score === 52)).toBe(true)
  })

  it('WEB-REC-011: weight/volume boundary at exactly 500 kg / 3 cbm still triggers the bonus', () => {
    // 大件（>=500 kg）和海运体积（>=3 cbm）加分在边界值上必须仍然命中
    // 这是 off-by-one 防御：>= 而非 >
    const { db } = useIsolatedDb(false)
    insertProduct(db, { id: 'p-edge-large', name: '大客户大票线' })
    insertProduct(db, { id: 'p-edge-sea', name: '海运基础线', transportMode: '海运拼箱' })

    const result = recommendProducts({
      ...baseInput,
      weightKg: 500,
      volumeCbm: 3
    })
    const scoreById = Object.fromEntries(result.map(item => [item.productId, item.score]))

    // base 52 + large(7) = 59, base 52 + sea(8) = 60
    expect(scoreById).toEqual({ 'p-edge-sea': 60, 'p-edge-large': 59 })
  })
})
