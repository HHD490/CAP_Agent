import { createRequire } from 'node:module'
import { getDb, demoNow, newId } from '../../utils/db'

// Compatibility-only: xlsx@0.18 exposes CommonJS on Windows Nitro dev.
// Keep the import behavior identical while avoiding the d:\\ ESM URL loader error.
const XLSX = createRequire(import.meta.url)('xlsx') as typeof import('xlsx')

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.data)
  if (!file) throw createError({ statusCode: 400, statusMessage: '请选择 CSV 或 Excel 文件' })
  if (file.data.length === 0) throw createError({ statusCode: 400, statusMessage: '文件内容为空，请选择有效的 CSV 或 Excel 文件' })
  if (file.data.length > 5 * 1024 * 1024) throw createError({ statusCode: 400, statusMessage: '文件不得超过 5 MB' })
  let rows: Record<string, any>[]
  try {
    const workbook = XLSX.read(file.data, { type: 'buffer' })
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) throw new Error('Workbook has no worksheets')
    const sheet = workbook.Sheets[firstSheetName]
    if (!sheet) throw new Error('Workbook first worksheet is unavailable')
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  } catch {
    throw createError({ statusCode: 400, statusMessage: '文件解析失败，请检查 CSV/Excel 格式' })
  }
  const db = getDb()
  const now = demoNow(db)
  let created = 0
  let skipped = 0
  for (const row of rows.slice(0, 200)) {
    const name = String(row.company || row.Company || row['公司名称'] || row.name || '').trim()
    const country = String(row.country || row.Country || row['国家'] || '').trim()
    const city = String(row.city || row.City || row['城市'] || '').trim()
    const website = String(row.website || row.Website || row['网站'] || '').trim()
    const email = String(row.email || row.Email || row['邮箱'] || '').trim().toLowerCase()
    const sourceRef = String(row.member_id || row['会员编号'] || '').trim()
    const domain = website.replace(/^https?:\/\//, '').split('/')[0] || email.split('@')[1] || ''
    if (!name) { skipped++; continue }
    const duplicate = sourceRef
      ? db.prepare(`SELECT id FROM customers WHERE source_ref = ?`).get(sourceRef)
      : domain && country ? db.prepare('SELECT id FROM customers WHERE domain = ? AND country = ?').get(domain, country) : null
    if (duplicate) { skipped++; continue }
    const id = newId('customer-import')
    db.prepare(`INSERT INTO customers
      (id, name, source, source_ref, country, city, website, domain, customer_type, status, profile_version, raw_json, facts_json,
       ai_profile_json, ai_profile_status, last_activity_at, created_at, updated_at)
      VALUES (?, ?, 'import', ?, ?, ?, ?, ?, 'unknown', 'normal', 1, ?, ?, '{}', 'pending', ?, ?, ?)`)
      .run(id, name, sourceRef, country, city, website, domain, JSON.stringify(row), JSON.stringify({ companyName: name, country, city, website }), now, now, now)
    if (email) {
      db.prepare(`INSERT INTO contacts (id, customer_id, name, title, email, email_normalized, status, is_primary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'verify', 1, ?, ?)`)
        .run(newId('contact'), id, String(row.contact || row['联系人'] || ''), String(row.title || row['职位'] || ''), email, email, now, now)
    }
    created++
  }
  return { ok: true, created, skipped, total: rows.length }
})
