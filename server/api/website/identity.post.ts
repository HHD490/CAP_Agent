import { z } from 'zod'
import { getDb, demoNow, newId, addEvent } from '../../utils/db'
import { createAgentTask } from '../../utils/agent'

const schema = z.object({
  inquiryId: z.string().min(1),
  email: z.string().email(),
  companyName: z.string().optional().default(''),
  contactName: z.string().optional().default(''),
  customerType: z.string().optional().default('unknown'),
  selectedProductId: z.string().optional().default('')
})

export default defineEventHandler(async (event) => {
  const body = schema.parse(await readBody(event))
  const db = getDb()
  const now = demoNow(db)
  const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(body.inquiryId) as any
  if (!inquiry) throw createError({ statusCode: 404, statusMessage: 'Visitor Session 或询价记录不存在，请重新提交需求' })
  const email = body.email.trim().toLowerCase()
  const domain = email.split('@')[1] || ''
  let contact = db.prepare('SELECT * FROM contacts WHERE email_normalized = ? ORDER BY created_at LIMIT 1').get(email) as any
  let customer = contact ? db.prepare('SELECT * FROM customers WHERE id = ?').get(contact.customer_id) as any : null
  if (!customer && domain) customer = db.prepare(`SELECT * FROM customers WHERE domain = ? AND source = 'website' ORDER BY created_at LIMIT 1`).get(domain) as any
  let customerId = customer?.id || ''
  if (!customerId) {
    customerId = newId('customer-web')
    db.prepare(`INSERT INTO customers
      (id, name, source, source_ref, country, city, website, domain, customer_type, status, profile_version, raw_json, facts_json,
       ai_profile_json, ai_profile_status, last_activity_at, created_at, updated_at)
      VALUES (?, ?, 'website', ?, '', '', '', ?, ?, 'normal', 1, ?, ?, '{}', 'pending', ?, ?, ?)`)
      .run(customerId, body.companyName || `网站访客 · ${domain}`, `WEB-${Date.now()}`, domain, body.customerType,
        JSON.stringify({ firstTouch: '虚拟官网询价', inquiryId: inquiry.id }),
        JSON.stringify({ capturedEmail: email, companyName: body.companyName, contactName: body.contactName, customerType: body.customerType }), now, now, now)
  } else {
    const facts = { ...JSON.parse(customer.facts_json || '{}'), capturedEmail: email, latestInquiryId: inquiry.id }
    db.prepare(`UPDATE customers SET facts_json = ?, profile_version = profile_version + 1, ai_profile_status = 'pending', last_activity_at = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(facts), now, now, customerId)
    db.prepare('UPDATE match_results SET stale = 1, updated_at = ? WHERE customer_id = ?').run(now, customerId)
    db.prepare(`UPDATE opportunities SET stale_review = 1, updated_at = ? WHERE customer_id = ? AND status IN ('active', 'handed_off')`).run(now, customerId)
  }
  if (!contact) {
    const contactId = newId('contact')
    db.prepare(`INSERT INTO contacts (id, customer_id, name, title, email, email_normalized, status, is_primary, created_at, updated_at)
      VALUES (?, ?, ?, '物流负责人', ?, ?, 'contactable', 1, ?, ?)`)
      .run(contactId, customerId, body.contactName, email, email, now, now)
    contact = { id: contactId, customer_id: customerId, email, status: 'contactable' }
  }
  const recs = JSON.parse(inquiry.recommendations_json || '[]') as any[]
  const productId = body.selectedProductId || recs[0]?.productId
  if (!productId || !db.prepare('SELECT id FROM products WHERE id = ?').get(productId)) throw createError({ statusCode: 400, statusMessage: '请选择有效的推荐产品' })
  let opportunity = db.prepare(`SELECT * FROM opportunities WHERE customer_id = ? AND product_id = ? AND status IN ('active', 'handed_off') LIMIT 1`).get(customerId, productId) as any
  if (!opportunity) {
    const opportunityId = newId('opp')
    db.prepare(`INSERT INTO opportunities
      (id, customer_id, product_id, contact_id, source, stage, status, focus, owner, next_action, due_at, blocker, stale_review,
       close_reason, ai_summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'passive', 1, 'active', 1, '', '等待 Agent 生成客户画像', ?, '', 0, '', '', ?, ?)`)
      .run(opportunityId, customerId, productId, contact.id, now, now, now)
    db.prepare('UPDATE opportunities SET focus = 0 WHERE customer_id = ? AND id <> ?').run(customerId, opportunityId)
    opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(opportunityId)
  }
  db.prepare(`UPDATE inquiries SET customer_id = ?, opportunity_id = ?, status = 'identified', updated_at = ? WHERE id = ?`).run(customerId, opportunity.id, now, inquiry.id)
  db.prepare('UPDATE website_sessions SET customer_id = ?, updated_at = ? WHERE id = ?').run(customerId, now, inquiry.session_id)
  addEvent({ opportunityId: opportunity.id, customerId, type: 'website_identity_captured', title: '官网访客已建立客户档案', description: `${email} 已完成身份留资，Agent 开始分析。`, source: 'website', data: { inquiryId: inquiry.id } }, db)
  return { ok: true, customerId, opportunityId: opportunity.id, task: createAgentTask('customer_profiling', 'customer', customerId, { autoMatch: true, inquiryId: inquiry.id }) }
})
