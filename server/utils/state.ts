import { getDb, demoNow } from './db'

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return value ? JSON.parse(String(value)) as T : fallback
  } catch {
    return fallback
  }
}

function contactFromRow(row: any) {
  return {
    id: row.id,
    customerId: row.customer_id,
    name: row.name,
    title: row.title,
    email: row.email,
    status: row.status,
    isPrimary: Boolean(row.is_primary)
  }
}

function productFromRow(row: any) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    transportMode: row.transport_mode,
    routes: parseJson(row.routes_json, []),
    cargoTypes: parseJson(row.cargo_types_json, []),
    capabilities: parseJson(row.capabilities_json, []),
    quoteReady: Boolean(row.quote_ready),
    referencePrice: row.reference_price,
    transitTime: row.transit_time,
    published: Boolean(row.published),
    productVersion: row.product_version,
    pmsSnapshot: parseJson(row.pms_snapshot_json, {}),
    marketing: parseJson(row.marketing_json, {}),
    simulated: Boolean(row.simulated),
    updatedAt: row.updated_at
  }
}

function draftFromRow(row: any) {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    version: row.version,
    language: row.language,
    subject: row.subject,
    body: row.body,
    status: row.status,
    recipient: row.recipient,
    sentAt: row.sent_at,
    createdAt: row.created_at
  }
}

function eventFromRow(row: any) {
  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    customerId: row.customer_id,
    type: row.type,
    title: row.title,
    description: row.description,
    source: row.source,
    data: parseJson(row.data_json, {}),
    createdAt: row.created_at
  }
}

function opportunityFromRow(row: any, db: ReturnType<typeof getDb>, withDetails = true) {
  const opportunity: Record<string, any> = {
    id: row.id,
    customerId: row.customer_id,
    productId: row.product_id,
    contactId: row.contact_id,
    source: row.source,
    stage: row.stage,
    status: row.status,
    focus: Boolean(row.focus),
    owner: row.owner,
    nextAction: row.next_action,
    dueAt: row.due_at,
    blocker: row.blocker,
    staleReview: Boolean(row.stale_review),
    closeReason: row.close_reason,
    aiSummary: row.ai_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  if (withDetails) {
    const contact = row.contact_id ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(row.contact_id) as any : null
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(row.product_id) as any
    opportunity.contact = contact ? contactFromRow(contact) : undefined
    opportunity.product = product ? productFromRow(product) : undefined
    opportunity.events = (db.prepare('SELECT * FROM opportunity_events WHERE opportunity_id = ? ORDER BY created_at DESC').all(row.id) as any[]).map(eventFromRow)
    opportunity.drafts = (db.prepare('SELECT * FROM email_drafts WHERE opportunity_id = ? ORDER BY version DESC, language').all(row.id) as any[]).map(draftFromRow)
  }
  return opportunity
}

function customerFromRow(row: any, db: ReturnType<typeof getDb>) {
  const contacts = (db.prepare('SELECT * FROM contacts WHERE customer_id = ? ORDER BY is_primary DESC, created_at').all(row.id) as any[]).map(contactFromRow)
  const opportunities = (db.prepare('SELECT * FROM opportunities WHERE customer_id = ? ORDER BY updated_at DESC').all(row.id) as any[])
    .map(item => opportunityFromRow(item, db, false))
  const focusOpportunity = opportunities.find(item => item.focus)
    || opportunities.filter(item => item.status === 'active').sort((a, b) => b.stage - a.stage)[0]
    || opportunities[0]
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    sourceRef: row.source_ref,
    country: row.country,
    city: row.city,
    website: row.website,
    domain: row.domain,
    customerType: row.customer_type,
    status: row.status,
    profileVersion: row.profile_version,
    raw: parseJson(row.raw_json, {}),
    facts: parseJson(row.facts_json, {}),
    aiProfile: parseJson(row.ai_profile_json, {}),
    aiProfileStatus: row.ai_profile_status,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contacts,
    opportunities,
    focusOpportunity
  }
}

function taskFromRow(row: any, db: ReturnType<typeof getDb>) {
  const steps = (db.prepare('SELECT * FROM agent_task_steps WHERE task_id = ? ORDER BY sequence').all(row.id) as any[]).map(step => ({
    id: step.id,
    taskId: step.task_id,
    sequence: step.sequence,
    phase: step.phase,
    summary: step.summary,
    data: parseJson(step.data_json, {}),
    createdAt: step.created_at
  }))
  return {
    id: row.id,
    mode: row.mode,
    targetType: row.target_type,
    targetId: row.target_id,
    status: row.status,
    phase: row.phase,
    progress: row.progress,
    currentStep: row.current_step,
    model: row.model,
    error: row.error,
    result: parseJson(row.result_json, {}),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    steps
  }
}

export function getDemoState() {
  const db = getDb()
  const customers = (db.prepare('SELECT * FROM customers ORDER BY last_activity_at DESC, name').all() as any[]).map(row => customerFromRow(row, db))
  const products = (db.prepare('SELECT * FROM products ORDER BY simulated, code').all() as any[]).map(productFromRow)
  const opportunities = (db.prepare('SELECT * FROM opportunities ORDER BY updated_at DESC').all() as any[]).map(row => opportunityFromRow(row, db))
  const customerMap = new Map(customers.map(customer => [customer.id, customer]))
  const productMap = new Map(products.map(product => [product.id, product]))
  const matches = (db.prepare('SELECT * FROM match_results ORDER BY stale DESC, score DESC, updated_at DESC').all() as any[]).map(row => ({
    id: row.id,
    customerId: row.customer_id,
    productId: row.product_id,
    score: row.score,
    confidence: row.confidence,
    evidence: parseJson(row.evidence_json, []),
    risks: parseJson(row.risks_json, []),
    missing: parseJson(row.missing_json, []),
    blockers: parseJson(row.blockers_json, []),
    customerVersion: row.customer_version,
    productVersion: row.product_version,
    stale: Boolean(row.stale),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customer: customerMap.get(row.customer_id),
    product: productMap.get(row.product_id)
  }))
  const tasks = (db.prepare('SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT 80').all() as any[]).map(row => taskFromRow(row, db))
  const inquiries = (db.prepare('SELECT * FROM inquiries ORDER BY updated_at DESC').all() as any[]).map(row => ({
    id: row.id,
    sessionId: row.session_id,
    customerId: row.customer_id,
    opportunityId: row.opportunity_id,
    status: row.status,
    origin: row.origin,
    destination: row.destination,
    cargoName: row.cargo_name,
    weightKg: row.weight_kg,
    volumeCbm: row.volume_cbm,
    preference: row.preference,
    details: parseJson(row.details_json, {}),
    recommendations: parseJson(row.recommendations_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
  const now = demoNow(db)
  const config = useRuntimeConfig()
  const allowlist = String(config.emailAllowlist || '').split(',').map(value => value.trim()).filter(Boolean)
  return {
    currentTime: now,
    counts: {
      totalCustomers: customers.length,
      wcaCustomers: customers.filter(customer => customer.source === 'wca_simulated').length,
      websiteCustomers: customers.filter(customer => customer.source === 'website').length,
      pendingProfiles: customers.filter(customer => customer.aiProfileStatus === 'pending').length,
      staleMatches: matches.filter(match => match.stale).length,
      activeOpportunities: opportunities.filter(opportunity => opportunity.status === 'active').length,
      explicitIntent: opportunities.filter(opportunity => opportunity.stage === 8 && opportunity.status === 'active').length,
      humanTasks: opportunities.filter(opportunity => opportunity.status === 'active' && (opportunity.blocker || opportunity.stage === 5 || opportunity.stage === 8 || (opportunity.dueAt && opportunity.dueAt <= now))).length,
      runningTasks: tasks.filter(task => ['queued', 'running', 'waiting'].includes(task.status)).length
    },
    customers,
    products,
    matches,
    opportunities: opportunities.map(opportunity => ({
      ...opportunity,
      customer: customerMap.get(opportunity.customerId)
    })),
    tasks,
    inquiries,
    emailAllowlist: allowlist,
    model: {
      configured: Boolean(config.llmBaseUrl && config.llmApiKey && config.llmModel),
      provider: String(config.llmProvider || 'openai-compatible'),
      name: String(config.llmModel || '未配置'),
      thinkingMode: String(config.llmThinkingMode || 'disabled'),
      reasoningEffort: String(config.llmReasoningEffort || 'high'),
      contextWindowTokens: Number(config.llmContextWindowTokens || 128000),
      modelMaxOutputTokens: Number(config.llmModelMaxOutputTokens || 32768),
      maxOutputTokens: Number(config.llmMaxOutputTokens || 65536)
    }
  }
}

export { customerFromRow, productFromRow, opportunityFromRow }
