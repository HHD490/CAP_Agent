import { getDb } from './db'

export function recommendProducts(input: { origin: string, destination: string, cargoName: string, weightKg: number, volumeCbm: number, preference: string }) {
  const db = getDb()
  const products = db.prepare('SELECT * FROM products WHERE published = 1').all() as any[]
  const destination = input.destination.toLowerCase()
  const cityCountryMap: Record<string, string> = {
    '洛杉矶': '美国', '纽约': '美国', '芝加哥': '美国', '西雅图': '美国',
    '伦敦': '英国', '汉堡': '德国', '巴黎': '法国', '鹿特丹': '荷兰',
    '东京': '日本', '大阪': '日本', '迪拜': '阿联酋', '利雅得': '沙特',
    '悉尼': '澳大利亚', '墨尔本': '澳大利亚', '曼谷': '泰国', '胡志明市': '越南'
  }
  const destinationRegion = cityCountryMap[input.destination.trim()] || input.destination
  const cargo = input.cargoName.toLowerCase()
  const scored = products.map(product => {
    const routes = JSON.parse(product.routes_json || '[]') as string[]
    const cargoTypes = JSON.parse(product.cargo_types_json || '[]') as string[]
    const capabilities = JSON.parse(product.capabilities_json || '[]') as string[]
    let score = 52
    const evidence: string[] = []
    if (routes.some(route => {
      const normalized = route.toLowerCase()
      const tail = route.split('-').pop()?.toLowerCase() || ''
      return normalized.includes(destination) || destination.includes(tail) || normalized.includes(destinationRegion.toLowerCase())
    })) {
      score += 28
      evidence.push(`覆盖 ${input.destination}（${destinationRegion}）方向`)
    }
    if (cargoTypes.some(type => cargo.includes(type.toLowerCase()) || type.toLowerCase().includes(cargo))) {
      score += 12
      evidence.push(`适配 ${input.cargoName} 品类`)
    }
    if (/带电|电池|蓝牙|电子/.test(cargo) && capabilities.some(value => /带电/.test(value))) {
      score += 10
      evidence.push('具备带电货物承接能力')
    }
    if (input.preference.includes('时效') && /特快|快线|特快/.test(product.name)) score += 6
    if (input.volumeCbm >= 3 && product.transport_mode.includes('海运')) score += 8
    if (input.weightKg >= 500 && /大客户|大票/.test(product.name)) score += 7
    return {
      productId: product.id,
      code: product.code,
      name: product.name,
      score: Math.min(98, score),
      evidence: evidence.length ? evidence : ['已发布产品，可进一步人工询价确认'],
      capabilities,
      quoteReady: Boolean(product.quote_ready),
      referencePrice: product.reference_price,
      transitTime: product.transit_time
    }
  })
  return scored.sort((a, b) => b.score - a.score).slice(0, 3)
}
