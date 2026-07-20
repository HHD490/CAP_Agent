import { z } from 'zod'
import { getDb, demoNow, newId } from '../../utils/db'
import { recommendProducts } from '../../utils/website'

const schema = z.object({
  sessionId: z.string().optional(),
  inquiryId: z.string().optional(),
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
  let sessionId = body.sessionId || ''
  if (!sessionId || !db.prepare('SELECT id FROM website_sessions WHERE id = ?').get(sessionId)) {
    sessionId = newId('session')
    db.prepare('INSERT INTO website_sessions (id, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(sessionId, '', now, now)
  }
  const recommendations = recommendProducts(body)
  let inquiryId = body.inquiryId || ''
  const existing = inquiryId ? db.prepare('SELECT * FROM inquiries WHERE id = ? AND session_id = ?').get(inquiryId, sessionId) as any : null
  if (existing) {
    db.prepare(`UPDATE inquiries SET origin = ?, destination = ?, cargo_name = ?, weight_kg = ?, volume_cbm = ?, preference = ?,
      details_json = ?, recommendations_json = ?, status = 'quoted', updated_at = ? WHERE id = ?`)
      .run(body.origin, body.destination, body.cargoName, body.weightKg, body.volumeCbm, body.preference,
        JSON.stringify(body.details), JSON.stringify(recommendations), now, inquiryId)
  } else {
    inquiryId = newId('inquiry')
    db.prepare(`INSERT INTO inquiries
      (id, session_id, customer_id, opportunity_id, status, origin, destination, cargo_name, weight_kg, volume_cbm, preference,
       details_json, recommendations_json, created_at, updated_at)
      VALUES (?, ?, '', '', 'quoted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(inquiryId, sessionId, body.origin, body.destination, body.cargoName, body.weightKg, body.volumeCbm, body.preference,
        JSON.stringify(body.details), JSON.stringify(recommendations), now, now)
  }
  db.prepare('UPDATE website_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
  return { sessionId, inquiryId, recommendations }
})
