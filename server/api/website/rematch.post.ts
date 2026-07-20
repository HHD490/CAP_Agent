import { z } from 'zod'
import { getDb, demoNow, addEvent } from '../../utils/db'
import { createAgentTask } from '../../utils/agent'
import { recommendProducts } from '../../utils/website'

const schema = z.object({
  inquiryId: z.string().min(1),
  origin: z.string().min(1),
  destination: z.string().min(1),
  cargoName: z.string().min(1),
  weightKg: z.coerce.number().positive(),
  volumeCbm: z.coerce.number().positive(),
  preference: z.string().min(1),
  details: z.record(z.string(), z.any()).optional().default({})
})

export default defineEventHandler(async (event) => {
  const body = schema.parse(await readBody(event))
  const db = getDb()
  const now = demoNow(db)
  const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(body.inquiryId) as any
  if (!inquiry) throw createError({ statusCode: 404, statusMessage: '询价记录不存在' })
  const recommendations = recommendProducts(body)
  db.prepare(`UPDATE inquiries SET origin = ?, destination = ?, cargo_name = ?, weight_kg = ?, volume_cbm = ?, preference = ?,
    details_json = ?, recommendations_json = ?, status = 'quoted', updated_at = ? WHERE id = ?`)
    .run(body.origin, body.destination, body.cargoName, body.weightKg, body.volumeCbm, body.preference,
      JSON.stringify(body.details), JSON.stringify(recommendations), now, body.inquiryId)
  let task = null
  if (inquiry.customer_id) {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(inquiry.customer_id) as any
    const facts = { ...JSON.parse(customer.facts_json || '{}'), latestInquiry: { ...body, recommendations }, updatedAt: now }
    db.prepare(`UPDATE customers SET facts_json = ?, profile_version = profile_version + 1, ai_profile_status = 'pending', last_activity_at = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(facts), now, now, inquiry.customer_id)
    db.prepare('UPDATE match_results SET stale = 1, updated_at = ? WHERE customer_id = ?').run(now, inquiry.customer_id)
    db.prepare(`UPDATE opportunities SET stale_review = 1, updated_at = ? WHERE customer_id = ? AND status IN ('active', 'handed_off')`).run(now, inquiry.customer_id)
    if (inquiry.opportunity_id) addEvent({ opportunityId: inquiry.opportunity_id, customerId: inquiry.customer_id, type: 'inquiry_modified', title: '客户修改了询价信息', description: '关键询价字段变化，系统已启动重新匹配。', source: 'website' }, db)
    task = createAgentTask('product_matching', 'customer', inquiry.customer_id, { triggeredBy: 'inquiry_modified', inquiryId: inquiry.id })
  }
  return { ok: true, recommendations, task }
})
