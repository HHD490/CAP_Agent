import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

let database: DatabaseSync | undefined

const schema = [
  `CREATE TABLE IF NOT EXISTS demo_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    current_time TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    source_ref TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    domain TEXT NOT NULL DEFAULT '',
    customer_type TEXT NOT NULL DEFAULT 'unknown',
    status TEXT NOT NULL DEFAULT 'normal',
    profile_version INTEGER NOT NULL DEFAULT 1,
    raw_json TEXT NOT NULL DEFAULT '{}',
    facts_json TEXT NOT NULL DEFAULT '{}',
    ai_profile_json TEXT NOT NULL DEFAULT '{}',
    ai_profile_status TEXT NOT NULL DEFAULT 'pending',
    last_activity_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_source_ref ON customers(source, source_ref) WHERE source_ref <> ''`,
  `CREATE INDEX IF NOT EXISTS idx_customer_domain_country ON customers(domain, country)`,
  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    email_normalized TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'verify',
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_contacts_customer ON contacts(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email_normalized)`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    transport_mode TEXT NOT NULL,
    routes_json TEXT NOT NULL DEFAULT '[]',
    cargo_types_json TEXT NOT NULL DEFAULT '[]',
    capabilities_json TEXT NOT NULL DEFAULT '[]',
    quote_ready INTEGER NOT NULL DEFAULT 0,
    reference_price TEXT NOT NULL DEFAULT '',
    transit_time TEXT NOT NULL DEFAULT '',
    published INTEGER NOT NULL DEFAULT 1,
    product_version INTEGER NOT NULL DEFAULT 1,
    pms_snapshot_json TEXT NOT NULL DEFAULT '{}',
    marketing_json TEXT NOT NULL DEFAULT '{}',
    simulated INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS match_results (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    confidence TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '[]',
    risks_json TEXT NOT NULL DEFAULT '[]',
    missing_json TEXT NOT NULL DEFAULT '[]',
    blockers_json TEXT NOT NULL DEFAULT '[]',
    customer_version INTEGER NOT NULL,
    product_version INTEGER NOT NULL,
    stale INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'proposed',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(customer_id, product_id, customer_version, product_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_matches_customer ON match_results(customer_id, score DESC)`,
  `CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    contact_id TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    stage INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    focus INTEGER NOT NULL DEFAULT 0,
    owner TEXT NOT NULL DEFAULT '',
    next_action TEXT NOT NULL DEFAULT '',
    due_at TEXT NOT NULL DEFAULT '',
    blocker TEXT NOT NULL DEFAULT '',
    stale_review INTEGER NOT NULL DEFAULT 0,
    close_reason TEXT NOT NULL DEFAULT '',
    ai_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_opportunities_customer ON opportunities(customer_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS opportunity_events (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL DEFAULT '',
    customer_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_opportunity ON opportunity_events(opportunity_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_events_customer ON opportunity_events(customer_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS email_drafts (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    language TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    recipient TEXT NOT NULL DEFAULT '',
    sent_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(opportunity_id, version, language)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    current_step TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    input_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT '',
    completed_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_target ON agent_tasks(target_type, target_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS agent_task_steps (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    phase TEXT NOT NULL,
    summary TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE(task_id, sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS website_sessions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inquiries (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    customer_id TEXT NOT NULL DEFAULT '',
    opportunity_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    cargo_name TEXT NOT NULL,
    weight_kg REAL NOT NULL,
    volume_cbm REAL NOT NULL,
    preference TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    recommendations_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`
]

/** Test-only seam: replace or clear the process-wide DB singleton. */
export function setDbForTests(db: DatabaseSync | undefined) {
  database = db
}

/** Apply schema/PRAGMA to an already-opened connection (used by tests and getDb). */
export function initializeDatabaseConnection(db: DatabaseSync, options: { seed?: boolean } = {}) {
  try { db.exec('PRAGMA journal_mode = WAL') } catch { /* :memory: / some hosts may reject WAL */ }
  db.exec('PRAGMA foreign_keys = ON')
  for (const statement of schema) db.exec(statement)
  if (options.seed) {
    const state = db.prepare('SELECT id FROM demo_state WHERE id = 1').get()
    if (!state) resetDemoDatabase(db)
    ensureWebsiteInquiryDemoData(db)
  }
}

export function getDb() {
  if (database) return database
  const config = useRuntimeConfig()
  const path = resolve(process.cwd(), String(config.databasePath || './data/acquisition-demo.sqlite'))
  mkdirSync(dirname(path), { recursive: true })
  database = new DatabaseSync(path)
  initializeDatabaseConnection(database)
  prepareOpenedDatabase(database)
  return database
}

/**
 * Post-open initialization for an existing connection.
 * Seeds only when demo_state is absent; never resets an already-seeded database.
 */
export function prepareOpenedDatabase(db: DatabaseSync) {
  const state = db.prepare('SELECT id FROM demo_state WHERE id = 1').get()
  if (!state) resetDemoDatabase(db)
  // Earlier PoC seed versions created all three website customers but only
  // persisted one inquiry. Keep existing demo databases consistent without
  // forcing a destructive reset or overwriting inquiries created in the UI.
  ensureWebsiteInquiryDemoData(db)
  runDatabaseMigrations(db)
  const now = demoNow(db)
  db.prepare(`UPDATE agent_tasks SET status = 'failed', phase = 'failed', error = ?, completed_at = ? WHERE status IN ('queued', 'running', 'waiting')`)
    .run('服务在 Agent 运行期间重启，本次任务已中断；可安全重新运行。', now)
}

const MIGRATION_BY004_UNPUBLISH = 'by004_unpublish_v1'

/** Idempotent schema/data migrations for already-seeded databases. */
export function runDatabaseMigrations(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
  const applied = db.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(MIGRATION_BY004_UNPUBLISH)
  if (applied) return

  const now = demoNow(db)
  const by004 = db.prepare('SELECT id, published, pms_snapshot_json FROM products WHERE code = ?').get('BY004') as any
  if (by004) {
    const snapshot = (() => {
      try { return JSON.parse(by004.pms_snapshot_json || '{}') } catch { return {} }
    })() as Record<string, unknown>
    const needsFix = Number(by004.published) === 1 || snapshot.published === true
    if (needsFix) {
      snapshot.published = false
      db.prepare('UPDATE products SET published = 0, pms_snapshot_json = ?, updated_at = ? WHERE code = ?')
        .run(JSON.stringify(snapshot), now, 'BY004')
    }
  }

  db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(MIGRATION_BY004_UNPUBLISH, now)
}

export function demoNow(db = getDb()) {
  // CURRENT_TIME is a SQLite keyword; quote the demo clock column so SQLite
  // does not silently return the real wall-clock time instead.
  return String((db.prepare('SELECT "current_time" FROM demo_state WHERE id = 1').get() as any)?.current_time || new Date().toISOString())
}

export function addEvent(input: {
  opportunityId?: string
  customerId: string
  type: string
  title: string
  description?: string
  source: 'system' | 'agent' | 'human' | 'website' | 'email'
  data?: unknown
}, db = getDb()) {
  db.prepare(`INSERT INTO opportunity_events
    (id, opportunity_id, customer_id, type, title, description, source, data_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), input.opportunityId || '', input.customerId, input.type, input.title,
      input.description || '', input.source, JSON.stringify(input.data || {}), demoNow(db))
}

export function resetDemoDatabase(db = getDb()) {
  db.exec('BEGIN')
  try {
    for (const table of [
      'agent_task_steps', 'agent_tasks', 'email_drafts', 'opportunity_events', 'opportunities',
      'match_results', 'contacts', 'inquiries', 'website_sessions', 'customers', 'products', 'demo_state'
    ]) db.exec(`DELETE FROM ${table}`)

    const now = '2026-07-17T02:00:00.000Z'
    db.prepare('INSERT INTO demo_state (id, current_time) VALUES (1, ?)').run(now)
    seedProducts(db, now)
    seedCustomers(db, now)
    seedMatchesAndOpportunities(db, now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function seedProducts(db: DatabaseSync, now: string) {
  // Each row explicitly carries quote_ready AND published (independent fields) plus simulated.
  const products = [
    ['product-by001', 'BY001', '美国空派标快（含税）', '空运', '空派专线', ['中国-美国'], ['普货', '纺织品'], ['DDP', '含税清关', '末端派送'], true, '¥ 42.0000/KG 起', '8–10 个工作日', true, false],
    ['product-by002', 'BY002', '美东大客户空派专线', '空运', '空派专线', ['中国-美国东部'], ['普货', '大票货'], ['大票优惠', '美东覆盖', '预约派送'], true, '¥ 38.5000/KG 起', '9–12 个工作日', true, false],
    ['product-by003', 'BY003', '美国空派特快带电', '空运', '空派专线', ['中国-美国'], ['带电产品', '消费电子'], ['带电可接', '快速清关', '全程轨迹'], true, '¥ 56.0000/KG 起', '5–7 个工作日', true, false],
    ['product-by004', 'BY004', '美国空派中技全链路', '空运', '空派专线', ['中国-美国'], ['普货', '带电产品'], ['上门提货', '出口报关', '清关派送'], false, '需人工询价', '7–10 个工作日', false, false],
    ['product-sim005', 'SIM005', '欧洲空派经济包税线', '空运', '空派专线', ['中国-德国', '中国-法国', '中国-荷兰'], ['普货', '服装'], ['DDP', '欧盟清关', '多国派送'], true, '¥ 36.8000/KG 起', '10–13 个工作日', true, true],
    ['product-sim006', 'SIM006', '英国空派敏感货专线', '空运', '空派专线', ['中国-英国'], ['化妆品', '弱磁产品'], ['敏感货预审', 'VAT 协同', '本地派送'], false, '需人工询价', '8–11 个工作日', true, true],
    ['product-sim007', 'SIM007', '美西海运快线（整柜）', '海运', '海运整柜', ['中国-美国西部'], ['普货', '家具', '大件货'], ['整柜', '洛杉矶/长滩', '卡车派送'], true, 'USD 3,280.0000/40HQ 起', '18–24 个自然日', true, true],
    ['product-sim008', 'SIM008', '美国海运拼箱卡派', '海运', '海运拼箱', ['中国-美国'], ['普货', '大件货'], ['LCL', '仓库集货', '卡车派送'], true, '¥ 1,480.0000/CBM 起', '25–32 个自然日', true, true],
    ['product-sim009', 'SIM009', '东南亚跨境陆运专线', '陆运', '跨境陆运', ['中国-泰国', '中国-越南', '中国-马来西亚'], ['普货', '工业配件'], ['门到门', '陆路清关', '整车/零担'], false, '需人工询价', '5–9 个工作日', true, true],
    ['product-sim010', 'SIM010', '日本电商小包特快', '快递', '国际小包', ['中国-日本'], ['电商小件', '普货'], ['一单到底', '末端宅配', '轨迹回传'], true, '¥ 28.0000/KG 起', '3–5 个工作日', true, true],
    ['product-sim011', 'SIM011', '澳洲空海联运稳定线', '联运', '空海联运', ['中国-澳大利亚'], ['普货', '户外用品'], ['空海联运', '悉尼/墨尔本', '尾程派送'], true, '¥ 22.6000/KG 起', '14–19 个工作日', true, true],
    ['product-sim012', 'SIM012', '中东空运门到门专线', '空运', '国际空运', ['中国-阿联酋', '中国-沙特'], ['普货', '汽配'], ['机场到门', '本地清关协同', '双清可选'], false, '需人工询价', '6–9 个工作日', true, true]
  ] as const
  const statement = db.prepare(`INSERT INTO products
    (id, code, name, category, transport_mode, routes_json, cargo_types_json, capabilities_json, quote_ready,
     reference_price, transit_time, published, product_version, pms_snapshot_json, marketing_json, simulated, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
  for (const [id, code, name, category, mode, routes, cargo, capabilities, quote, price, transit, published, simulated] of products) {
    statement.run(id, code, name, category, mode, JSON.stringify(routes), JSON.stringify(cargo), JSON.stringify(capabilities), quote ? 1 : 0,
      price, transit, published ? 1 : 0,
      JSON.stringify({ code, name, published: Boolean(published), source: simulated ? 'PoC 模拟 PMS 快照' : 'PMS 原型快照' }),
      JSON.stringify({ headline: `${routes.join(' / ')} · ${transit}`, sellingPoints: capabilities, idealCustomer: cargo.join('、') }),
      simulated ? 1 : 0, now)
  }
}

function seedCustomers(db: DatabaseSync, now: string) {
  const regions = [
    ['美国', '洛杉矶'], ['美国', '纽约'], ['加拿大', '多伦多'], ['英国', '伦敦'], ['德国', '汉堡'],
    ['法国', '巴黎'], ['荷兰', '鹿特丹'], ['意大利', '米兰'], ['西班牙', '巴塞罗那'], ['澳大利亚', '悉尼'],
    ['新西兰', '奥克兰'], ['日本', '东京'], ['韩国', '釜山'], ['新加坡', '新加坡'], ['马来西亚', '吉隆坡'],
    ['泰国', '曼谷'], ['越南', '胡志明市'], ['阿联酋', '迪拜'], ['沙特', '利雅得'], ['印度', '孟买'],
    ['墨西哥', '墨西哥城'], ['巴西', '圣保罗'], ['智利', '圣地亚哥'], ['南非', '约翰内斯堡'], ['土耳其', '伊斯坦布尔'],
    ['波兰', '华沙'], ['比利时', '安特卫普'], ['瑞典', '哥德堡'], ['挪威', '奥斯陆'], ['印度尼西亚', '雅加达']
  ]
  const prefixes = ['Atlas', 'BlueHarbor', 'NorthStar', 'Meridian', 'SwiftBridge', 'OceanPeak', 'TerraLink', 'NovaFreight', 'CargoVista', 'PrimeRoute']
  const customerInsert = db.prepare(`INSERT INTO customers
    (id, name, source, source_ref, country, city, website, domain, customer_type, status, profile_version,
     raw_json, facts_json, ai_profile_json, ai_profile_status, last_activity_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', 1, ?, ?, ?, ?, ?, ?, ?)`)
  const contactInsert = db.prepare(`INSERT INTO contacts
    (id, customer_id, name, title, email, email_normalized, status, is_primary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

  regions.forEach(([country, city], index) => {
    const n = String(index + 1).padStart(2, '0')
    const name = `${prefixes[index % prefixes.length]} ${city} Logistics`
    const domain = `demo-forwarder-${n}.example`
    const id = `customer-wca-${n}`
    const routes = index < 8 ? ['美国进口', '中国出口'] : index < 18 ? ['欧洲/亚太进口', '中国出口'] : ['区域转运', '中国出口']
    const profileReady = index < 22
    const facts = {
      companyNature: '海外货运代理',
      memberNetwork: 'WCA（PoC 模拟）',
      serviceCapabilities: index % 3 === 0 ? ['空运', '清关', '末端派送'] : index % 3 === 1 ? ['海运', '仓储', '卡车派送'] : ['空运', '海运', '跨境电商物流'],
      lanes: routes,
      languages: ['英语']
    }
    const aiProfile = profileReady ? {
      summary: `${city}本地货代，具备${(facts.serviceCapabilities as string[]).join('、')}能力，可能需要稳定的中国出口合作伙伴。`,
      customerType: 'freight_forwarder_partner',
      likelyNeeds: ['中国出口运力', '稳定时效', '目的港协作'],
      confidence: index < 10 ? 'high' : 'medium',
      evidence: ['公司服务范围', '所在区域', '模拟会员目录字段']
    } : {}
    customerInsert.run(id, name, 'wca_simulated', `WCA-SIM-${1001 + index}`, country, city, `https://${domain}`, domain,
      'freight_forwarder_partner', JSON.stringify({ simulatedDirectoryListing: true, memberId: `WCA-SIM-${1001 + index}`, capturedAt: now }),
      JSON.stringify(facts), JSON.stringify(aiProfile), profileReady ? 'suggested' : 'pending', now, now, now)
    const email = index === 0 ? 'test@example.com' : `partnership@${domain}`
    contactInsert.run(`contact-wca-${n}`, id, index === 0 ? 'Alex Chen' : `Demo Contact ${n}`, 'Partnership Manager', email, email.toLowerCase(), 'contactable', 1, now, now)
  })

  const websiteCustomers = [
    ['customer-web-01', '远舟跨境贸易', '中国', '深圳', 'ecommerce_seller', '陈经理', 'history@example.com'],
    ['customer-web-02', '星海智能家居', '中国', '东莞', 'exporter', '林女士', 'lin@example.com'],
    ['customer-web-03', '恒拓汽配出口', '中国', '宁波', 'direct_shipper', '周经理', 'zhou@example.com']
  ]
  for (const [id, name, country, city, type, contact, email] of websiteCustomers) {
    customerInsert.run(id, name, 'website', `WEB-${id.slice(-2)}`, country, city, '', email.split('@')[1], type,
      JSON.stringify({ firstTouch: '虚拟官网询价', consent: 'PoC 模拟' }),
      JSON.stringify({ companyNature: type, capturedEmail: email, recentInquiry: true }),
      JSON.stringify({ summary: `${name}通过官网提交跨境物流询价。`, customerType: type, likelyNeeds: ['报价', '时效对比'], confidence: 'high', evidence: ['官网询价字段'] }),
      'suggested', now, now, now)
    contactInsert.run(`contact-${id}`, id, contact, '物流负责人', email, email.toLowerCase(), 'contactable', 1, now, now)
  }
}

function seedMatchesAndOpportunities(db: DatabaseSync, now: string) {
  const matchInsert = db.prepare(`INSERT INTO match_results
    (id, customer_id, product_id, score, confidence, evidence_json, risks_json, missing_json, blockers_json,
     customer_version, product_version, stale, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`)
  const matchSeeds = [
    ['match-01', 'customer-wca-01', 'product-by001', 92, 'high', ['美国本地派送能力', '寻求中国出口合作'], [], ['月均货量'], 0, 'accepted'],
    ['match-02', 'customer-wca-01', 'product-by003', 84, 'medium', ['覆盖美国市场', '可承接消费电子'], ['带电资质需确认'], ['目标州'], 0, 'proposed'],
    ['match-03', 'customer-wca-02', 'product-by002', 89, 'high', ['美东网点', '具备大票货操作经验'], [], ['周均出货频次'], 0, 'accepted'],
    ['match-04', 'customer-wca-05', 'product-sim005', 87, 'high', ['德国清关与派送资源', '需要中国出口空运'], [], ['DDP 税号协同方式'], 0, 'proposed'],
    ['match-05', 'customer-wca-07', 'product-sim007', 81, 'medium', ['鹿特丹海运能力', '大件货客户基础'], ['线路目的地需进一步确认'], ['柜量'], 1, 'proposed'],
    ['match-06', 'customer-web-01', 'product-sim008', 94, 'high', ['询价目的地为洛杉矶', '体积适合海运拼箱'], [], ['出货日期'], 0, 'accepted'],
    ['match-07', 'customer-web-01', 'product-by001', 78, 'medium', ['需要对比时效', '美国方向'], ['重量对空运成本敏感'], [], 0, 'proposed'],
    ['match-08', 'customer-web-02', 'product-by003', 96, 'high', ['蓝牙智能家居产品带电', '要求 7 日左右签收'], [], ['电池 MSDS'], 0, 'accepted'],
    ['match-09', 'customer-web-03', 'product-sim012', 91, 'high', ['汽配品类适配', '目的地迪拜'], [], ['贸易条款'], 0, 'accepted']
  ] as const
  for (const [id, customer, product, score, confidence, evidence, risks, missing, stale, status] of matchSeeds) {
    matchInsert.run(id, customer, product, score, confidence, JSON.stringify(evidence), JSON.stringify(risks), JSON.stringify(missing), '[]', stale, status, now, now)
  }

  const oppInsert = db.prepare(`INSERT INTO opportunities
    (id, customer_id, product_id, contact_id, source, stage, status, focus, owner, next_action, due_at, blocker, stale_review,
     close_reason, ai_summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`)
  const opps = [
    ['opp-01', 'customer-wca-01', 'product-by001', 'contact-wca-01', 'active', 9, 'handed_off', 1, '负责人 A', '与客户确认首次沟通时间', '2026-07-18T02:00:00.000Z', '', 0, '客户明确询问美国空派价格与合作方式，已完成交接。'],
    ['opp-02', 'customer-wca-02', 'product-by002', 'contact-wca-02', 'active', 8, 'active', 1, '', '确认分配负责人', '2026-07-17T10:00:00.000Z', '', 0, '客户回复希望本周安排产品说明会，属于明确意向。'],
    ['opp-03', 'customer-web-01', 'product-sim008', 'contact-customer-web-01', 'passive', 7, 'active', 1, '', '分析客户回复并判断意向', '2026-07-17T06:00:00.000Z', '', 0, '官网询价客户已回复邮件，等待 Agent 资格判断。'],
    ['opp-04', 'customer-web-02', 'product-by003', 'contact-customer-web-02', 'passive', 6, 'active', 1, '负责人 B', '3 天后发送首次跟进', '2026-07-20T02:00:00.000Z', '', 0, '已发送带电空派方案，等待客户回复。'],
    ['opp-05', 'customer-wca-05', 'product-sim005', 'contact-wca-05', 'active', 5, 'active', 1, '负责人 C', '人工审核并发送建联邮件', '2026-07-17T08:00:00.000Z', '', 0, '中欧空派合作匹配度高，中文建联草稿已生成。'],
    ['opp-06', 'customer-web-03', 'product-sim012', '', 'passive', 4, 'active', 1, '', '补充有效联系人', '2026-07-18T02:00:00.000Z', '缺少可用于建联的有效联系人', 0, '匹配已接受，但联系人尚待核验。']
  ] as const
  for (const row of opps) oppInsert.run(...row, now, now)

  const draftInsert = db.prepare(`INSERT INTO email_drafts
    (id, opportunity_id, version, language, subject, body, status, recipient, sent_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  draftInsert.run('draft-opp01-zh', 'opp-01', 1, 'zh', '关于美国空派合作的进一步沟通', 'Alex 您好，基于贵司在美国本地派送方面的能力，我们希望进一步讨论中国至美国空派标快的合作机会。', 'sent', 'test@example.com', '2026-07-16T03:00:00.000Z', now)
  draftInsert.run('draft-opp02-zh', 'opp-02', 1, 'zh', '美东大票空派合作方案', '您好，我们注意到贵司在美东拥有稳定的清关与派送资源，希望与您探讨美东大票空派专线合作。', 'sent', 'partnership@demo-forwarder-02.example', '2026-07-16T05:00:00.000Z', now)
  draftInsert.run('draft-opp04-zh', 'opp-04', 1, 'zh', '带电智能家居产品美国空派方案', '林女士您好，根据您在官网提交的智能家居产品询价，我们整理了美国空派特快带电方案，供您评估。', 'sent', 'lin@example.com', '2026-07-17T01:00:00.000Z', now)
  draftInsert.run('draft-opp05-zh', 'opp-05', 1, 'zh', '中德空派包税合作建议', '您好，结合贵司在德国的清关与派送网络，我们建议共同评估欧洲空派经济包税线的合作空间。', 'draft', 'partnership@demo-forwarder-05.example', '', now)

  const events = [
    ['opp-01', 'customer-wca-01', 'handoff', '已分配负责人', '负责人 A 已接手，Agent 已生成交接摘要。', 'human', '2026-07-17T01:40:00.000Z'],
    ['opp-01', 'customer-wca-01', 'reply_qualified', '客户表达明确意向', '客户希望获得下周舱位与合作价表。', 'agent', '2026-07-17T01:20:00.000Z'],
    ['opp-02', 'customer-wca-02', 'reply_received', '收到客户回复', '希望本周安排 30 分钟产品说明会。', 'email', '2026-07-17T01:10:00.000Z'],
    ['opp-03', 'customer-web-01', 'reply_received', '收到客户回复', '价格看起来可以，能否按每月 5–8 CBM 给长期合作方案？', 'email', '2026-07-17T01:55:00.000Z'],
    ['opp-04', 'customer-web-02', 'email_sent', '建联邮件已发送', '已向官网询价联系人发送中文方案。', 'human', '2026-07-17T01:00:00.000Z'],
    ['opp-05', 'customer-wca-05', 'draft_ready', '建联内容已就绪', 'Agent 已生成首版中文建联邮件，等待人工审核。', 'agent', '2026-07-17T00:45:00.000Z'],
    ['opp-06', 'customer-web-03', 'match_accepted', '匹配已接受', '中东空运门到门专线已形成获客机会。', 'human', '2026-07-16T09:20:00.000Z']
  ] as const
  const eventInsert = db.prepare(`INSERT INTO opportunity_events
    (id, opportunity_id, customer_id, type, title, description, source, data_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)`)
  events.forEach((row, i) => eventInsert.run(`event-seed-${i + 1}`, ...row))

  ensureWebsiteInquiryDemoData(db)

  const historicalTasks = [
    ['task-seed-01', 'customer_profiling', 'customer', 'customer-wca-01', 'completed', 'completed', 100, '客户画像已生成'],
    ['task-seed-02', 'product_matching', 'customer', 'customer-web-02', 'completed', 'completed', 100, 'Top 3 产品匹配已完成'],
    ['task-seed-03', 'outreach_drafting', 'opportunity', 'opp-05', 'completed', 'completed', 100, '中文建联草稿已生成']
  ] as const
  const taskInsert = db.prepare(`INSERT INTO agent_tasks
    (id, mode, target_type, target_id, status, phase, progress, current_step, model, result_json, created_at, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'deepseek-v4-pro', ?, ?, ?, ?)`)
  historicalTasks.forEach(([id, mode, targetType, targetId, status, phase, progress, step], i) => {
    taskInsert.run(id, mode, targetType, targetId, status, phase, progress, step,
      JSON.stringify({ seeded: true, note: '演示种子结果，不代表本次实时模型调用。' }), now, now, now)
    db.prepare(`INSERT INTO agent_task_steps (id, task_id, sequence, phase, summary, data_json, created_at) VALUES (?, ?, 1, ?, ?, ?, ?)`)
      .run(`step-seed-${i + 1}`, id, phase, step, JSON.stringify({ seeded: true }), now)
  })
}

function ensureWebsiteInquiryDemoData(db: DatabaseSync) {
  const sessions = [
    ['session-seed-01', 'customer-web-01', '2026-07-17T02:00:00.000Z'],
    ['session-seed-02', 'customer-web-01', '2026-07-14T03:20:00.000Z'],
    ['session-seed-03', 'customer-web-02', '2026-07-15T06:10:00.000Z'],
    ['session-seed-04', 'customer-web-02', '2026-07-17T00:35:00.000Z'],
    ['session-seed-05', 'customer-web-03', '2026-07-16T08:50:00.000Z']
  ] as const
  const sessionInsert = db.prepare(`INSERT OR IGNORE INTO website_sessions
    (id, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)`)
  for (const [id, customerId, timestamp] of sessions) {
    sessionInsert.run(id, customerId, timestamp, timestamp)
  }

  const inquiries = [
    {
      id: 'inquiry-seed-01', sessionId: 'session-seed-01', customerId: 'customer-web-01', opportunityId: 'opp-03',
      status: 'converted', origin: '深圳', destination: '洛杉矶', cargoName: '蓝牙音箱（带电）', weightKg: 820, volumeCbm: 5.4,
      preference: '平衡价格与时效', details: { shipmentDate: '2026-07-24', monthlyVolume: '5–8 CBM', tradeTerm: 'DDP' },
      recommendations: [{ productId: 'product-sim008', fit: 94 }, { productId: 'product-by001', fit: 78 }],
      timestamp: '2026-07-17T02:00:00.000Z'
    },
    {
      id: 'inquiry-seed-02', sessionId: 'session-seed-02', customerId: 'customer-web-01', opportunityId: '',
      status: 'quoted', origin: '广州', destination: '洛杉矶', cargoName: '家居收纳配件', weightKg: 560, volumeCbm: 3.2,
      preference: '优先价格', details: { shipmentDate: '2026-07-19', monthlyVolume: '3–5 CBM', tradeTerm: 'DDP' },
      recommendations: [{ productId: 'product-sim008', fit: 89 }, { productId: 'product-by001', fit: 74 }],
      timestamp: '2026-07-14T03:20:00.000Z'
    },
    {
      id: 'inquiry-seed-03', sessionId: 'session-seed-03', customerId: 'customer-web-02', opportunityId: '',
      status: 'quoted', origin: '东莞', destination: '纽约', cargoName: '智能灯具（带电）', weightKg: 420, volumeCbm: 2.6,
      preference: '优先价格', details: { shipmentDate: '2026-07-22', monthlyVolume: '2–4 CBM', tradeTerm: 'DDP', batteryDocument: '待补充' },
      recommendations: [{ productId: 'product-by003', fit: 91 }, { productId: 'product-by004', fit: 82 }],
      timestamp: '2026-07-15T06:10:00.000Z'
    },
    {
      id: 'inquiry-seed-04', sessionId: 'session-seed-04', customerId: 'customer-web-02', opportunityId: 'opp-04',
      status: 'converted', origin: '深圳', destination: '洛杉矶', cargoName: '智能家居控制器（带电）', weightKg: 680, volumeCbm: 4.1,
      preference: '优先时效', details: { shipmentDate: '2026-07-25', monthlyVolume: '4–6 CBM', tradeTerm: 'DDP', batteryDocument: 'MSDS 已备' },
      recommendations: [{ productId: 'product-by003', fit: 96 }, { productId: 'product-by004', fit: 86 }],
      timestamp: '2026-07-17T00:35:00.000Z'
    },
    {
      id: 'inquiry-seed-05', sessionId: 'session-seed-05', customerId: 'customer-web-03', opportunityId: 'opp-06',
      status: 'converted', origin: '宁波', destination: '迪拜', cargoName: '汽车悬挂配件', weightKg: 1350, volumeCbm: 6.8,
      preference: '平衡价格与时效', details: { shipmentDate: '2026-07-28', monthlyVolume: '6–10 CBM', tradeTerm: 'FOB', packageType: '托盘' },
      recommendations: [{ productId: 'product-sim012', fit: 91 }, { productId: 'product-by004', fit: 67 }],
      timestamp: '2026-07-16T08:50:00.000Z'
    }
  ]
  const inquiryInsert = db.prepare(`INSERT OR IGNORE INTO inquiries
    (id, session_id, customer_id, opportunity_id, status, origin, destination, cargo_name, weight_kg, volume_cbm, preference,
     details_json, recommendations_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const inquiry of inquiries) {
    inquiryInsert.run(inquiry.id, inquiry.sessionId, inquiry.customerId, inquiry.opportunityId, inquiry.status,
      inquiry.origin, inquiry.destination, inquiry.cargoName, inquiry.weightKg, inquiry.volumeCbm, inquiry.preference,
      JSON.stringify(inquiry.details), JSON.stringify(inquiry.recommendations), inquiry.timestamp, inquiry.timestamp)
  }
  // Normalize the one legacy row created by the first PoC seed. The condition
  // is deliberately narrow so real inquiries edited through the demo remain untouched.
  db.prepare(`UPDATE inquiries SET status = 'converted'
    WHERE id = 'inquiry-seed-01' AND status = 'identified'`).run()
}

export function newId(prefix: string) {
  return `${prefix}-${randomUUID()}`
}

/** Invalidate non-accepted matches for a customer. Accepted (human-confirmed) rows are never auto-staled. */
export function markNonAcceptedMatchesStale(customerId: string, db = getDb(), now = demoNow(db)) {
  db.prepare('UPDATE match_results SET stale = 1, updated_at = ? WHERE customer_id = ? AND status <> ?')
    .run(now, customerId, 'accepted')
}
