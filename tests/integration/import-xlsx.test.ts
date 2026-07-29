import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import importHandler from '../../server/api/import/customers.post'

const XLSX = createRequire(import.meta.url)('xlsx') as typeof import('xlsx')

function buildCustomerXlsx() {
  const sheet = XLSX.utils.json_to_sheet([{
    company: 'Smoke Import Co',
    country: '美国',
    city: '西雅图',
    website: 'https://smoke-import.example',
    email: 'buyer@smoke-import.example',
    contact: 'Smoke Buyer',
    member_id: 'IMP-SMOKE-001'
  }])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Customers')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
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
})
