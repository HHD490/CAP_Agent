import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import importHandler from '../../server/api/import/customers.post'

const XLSX = createRequire(import.meta.url)('xlsx') as typeof import('xlsx')

function buildWorkbook(rows: Record<string, unknown>[], bookType: 'xlsx' | 'csv' = 'xlsx') {
  const sheet = XLSX.utils.json_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Customers')
  return XLSX.write(book, { type: 'buffer', bookType }) as Buffer
}

function buildCustomerXlsx() {
  return buildWorkbook([{
    company: 'Smoke Import Co',
    country: '美国',
    city: '西雅图',
    website: 'https://smoke-import.example',
    email: 'buyer@smoke-import.example',
    contact: 'Smoke Buyer',
    member_id: 'IMP-SMOKE-001'
  }])
}

describe('IMPORT-XLSX integration (handler + isolated DB)', () => {
  it('IMPORT-XLSX-002: multipart xlsx creates one customer and contact', async () => {
    const { db } = useIsolatedDb()
    const buffer = buildCustomerXlsx()
    const result = await importHandler({
      __parts: [{ name: 'file', filename: 'customers.xlsx', data: buffer }]
    } as any)

    expect(result.ok).toBe(true)
    expect(result.created).toBe(1)
    const customer = db.prepare(`SELECT * FROM customers WHERE source_ref = 'IMP-SMOKE-001'`).get() as any
    expect(customer).toBeTruthy()
    expect(customer.name).toBe('Smoke Import Co')
    const contact = db.prepare(`SELECT * FROM contacts WHERE customer_id = ?`).get(customer.id) as any
    expect(contact.email).toBe('buyer@smoke-import.example')
  })

  it('IMPORT-XLSX-004: missing file and oversized file still return 400 business errors', async () => {
    useIsolatedDb()
    await expect(importHandler({ __parts: [] } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringMatching(/CSV|Excel|文件/)
    })

    const huge = Buffer.alloc(5 * 1024 * 1024 + 1, 1)
    await expect(importHandler({
      __parts: [{ name: 'file', filename: 'big.xlsx', data: huge }]
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringMatching(/5 MB|不得超过/)
    })
  })

  it('IMPORT-XLSX-005: CSV data and Chinese headers are supported through the same multipart contract', async () => {
    const { db } = useIsolatedDb()
    const buffer = buildWorkbook([{
      公司名称: '中文表头客户',
      国家: '德国',
      城市: '汉堡',
      网站: 'https://cn-header.example/path',
      邮箱: ' SALES@CN-HEADER.EXAMPLE ',
      联系人: '王经理',
      职位: '物流经理',
      会员编号: 'CN-HEADER-001'
    }], 'csv')

    const result = await importHandler({
      __parts: [{ name: 'file', filename: 'customers.csv', data: buffer }]
    } as any)
    const customer = db.prepare(`SELECT * FROM customers WHERE source_ref = 'CN-HEADER-001'`).get() as any
    const contact = db.prepare('SELECT * FROM contacts WHERE customer_id = ?').get(customer.id) as any

    expect(result).toMatchObject({ ok: true, created: 1, skipped: 0, total: 1 })
    expect(customer).toMatchObject({
      name: '中文表头客户',
      country: '德国',
      city: '汉堡',
      domain: 'cn-header.example'
    })
    expect(contact).toMatchObject({
      name: '王经理',
      title: '物流经理',
      email: 'sales@cn-header.example',
      email_normalized: 'sales@cn-header.example',
      status: 'verify'
    })
  })

  it('IMPORT-XLSX-006: rows without a company name are skipped and do not create orphan contacts', async () => {
    const { db } = useIsolatedDb()
    const beforeCustomers = Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)
    const beforeContacts = Number((db.prepare('SELECT COUNT(*) AS count FROM contacts').get() as any).count)
    const buffer = buildWorkbook([
      { company: '   ', email: 'orphan@example.invalid', member_id: 'NO-NAME-001' },
      { company: '', email: 'orphan2@example.invalid', member_id: 'NO-NAME-002' }
    ])

    const result = await importHandler({
      __parts: [{ name: 'file', filename: 'blank-names.xlsx', data: buffer }]
    } as any)

    expect(result).toMatchObject({ created: 0, skipped: 2, total: 2 })
    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)).toBe(beforeCustomers)
    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM contacts').get() as any).count)).toBe(beforeContacts)
  })

  it('IMPORT-XLSX-007: duplicate member ids within one file create only the first row', async () => {
    const { db } = useIsolatedDb()
    const buffer = buildWorkbook([
      { company: 'First Name Wins', country: '美国', member_id: 'DUP-IN-FILE-001' },
      { company: 'Second Duplicate', country: '英国', member_id: 'DUP-IN-FILE-001' }
    ])

    const result = await importHandler({
      __parts: [{ name: 'file', filename: 'duplicates.xlsx', data: buffer }]
    } as any)
    const rows = db.prepare(`SELECT * FROM customers WHERE source_ref = 'DUP-IN-FILE-001'`).all() as any[]

    expect(result).toMatchObject({ created: 1, skipped: 1, total: 2 })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('First Name Wins')
  })

  it('IMPORT-XLSX-008: same domain + country is deduplicated when member id is absent', async () => {
    const { db } = useIsolatedDb()
    const buffer = buildWorkbook([
      { company: 'Domain First', country: '加拿大', website: 'https://same-domain.example/path' },
      { company: 'Domain Duplicate', country: '加拿大', website: 'https://same-domain.example/other' },
      { company: 'Same Domain Other Country', country: '美国', website: 'https://same-domain.example' }
    ])

    const result = await importHandler({
      __parts: [{ name: 'file', filename: 'domain-dedup.xlsx', data: buffer }]
    } as any)

    expect(result).toMatchObject({ created: 2, skipped: 1, total: 3 })
    expect(db.prepare(`SELECT name FROM customers WHERE domain = 'same-domain.example' AND country = '加拿大'`).all()).toHaveLength(1)
    expect(db.prepare(`SELECT name FROM customers WHERE domain = 'same-domain.example' AND country = '美国'`).all()).toHaveLength(1)
  })

  it('IMPORT-XLSX-009: processing is capped at 200 rows while total reports the source size', async () => {
    const { db } = useIsolatedDb()
    const rows = Array.from({ length: 205 }, (_, index) => ({
      company: `Bulk Customer ${index + 1}`,
      country: '测试国',
      member_id: `BULK-${String(index + 1).padStart(3, '0')}`
    }))
    const buffer = buildWorkbook(rows)

    const result = await importHandler({
      __parts: [{ name: 'file', filename: 'bulk.xlsx', data: buffer }]
    } as any)

    expect(result).toMatchObject({ created: 200, skipped: 0, total: 205 })
    expect(Number((db.prepare(`SELECT COUNT(*) AS count FROM customers WHERE source_ref LIKE 'BULK-%'`).get() as any).count)).toBe(200)
    expect(db.prepare(`SELECT id FROM customers WHERE source_ref = 'BULK-201'`).get()).toBeUndefined()
  })

  it('IMPORT-XLSX-010: rows without email create a customer but no contact', async () => {
    const { db } = useIsolatedDb()
    const buffer = buildWorkbook([{
      Company: 'No Email Customer',
      Country: '法国',
      Website: 'https://no-email.example',
      member_id: 'NO-EMAIL-001'
    }])

    const result = await importHandler({
      __parts: [{ name: 'file', filename: 'no-email.xlsx', data: buffer }]
    } as any)
    const customer = db.prepare(`SELECT * FROM customers WHERE source_ref = 'NO-EMAIL-001'`).get() as any

    expect(result.created).toBe(1)
    expect(customer).toBeTruthy()
    expect(db.prepare('SELECT id FROM contacts WHERE customer_id = ?').get(customer.id)).toBeUndefined()
  })
})
