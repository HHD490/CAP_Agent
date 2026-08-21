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

  it('IMPORT-XLSX-011: a multipart field that is not named file is rejected without writes', async () => {
    const { db } = useIsolatedDb()
    const beforeCustomers = Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)

    await expect(importHandler({
      __parts: [{ name: 'attachment', filename: 'customers.xlsx', data: buildCustomerXlsx() }]
    } as any)).rejects.toMatchObject({ statusCode: 400 })

    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)).toBe(beforeCustomers)
  })

  it('IMPORT-XLSX-012: empty file returns a business error without writes', async () => {
    const { db } = useIsolatedDb()
    const beforeCustomers = Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)
    const beforeContacts = Number((db.prepare('SELECT COUNT(*) AS count FROM contacts').get() as any).count)

    await expect(importHandler({
      __parts: [{ name: 'file', filename: 'empty.xlsx', data: Buffer.alloc(0) }]
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringMatching(/CSV|Excel|为空/)
    })

    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)).toBe(beforeCustomers)
    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM contacts').get() as any).count)).toBe(beforeContacts)
  })

  it('IMPORT-XLSX-012b: malformed ZIP workbook returns a business error without writes', async () => {
    const { db } = useIsolatedDb()
    const beforeCustomers = Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)

    await expect(importHandler({
      __parts: [{ name: 'file', filename: 'broken.xlsx', data: Buffer.from([0x50, 0x4b, 0x03, 0x04]) }]
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringMatching(/CSV|Excel|澶辫触/)
    })

    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)).toBe(beforeCustomers)
  })

  it('IMPORT-XLSX-013: a member id already present in the database is skipped across import batches', async () => {
    const { db } = useIsolatedDb()
    const first = buildWorkbook([{ company: 'Original Member', country: '缇庡浗', member_id: 'CROSS-BATCH-001' }])
    const second = buildWorkbook([{ company: 'Duplicate Member', country: '鑻卞浗', member_id: 'CROSS-BATCH-001' }])

    expect(await importHandler({ __parts: [{ name: 'file', filename: 'first.xlsx', data: first }] } as any))
      .toMatchObject({ created: 1, skipped: 0 })
    expect(await importHandler({ __parts: [{ name: 'file', filename: 'second.xlsx', data: second }] } as any))
      .toMatchObject({ created: 0, skipped: 1 })

    const rows = db.prepare(`SELECT name FROM customers WHERE source_ref = 'CROSS-BATCH-001'`).all() as any[]
    expect(rows).toEqual([{ name: 'Original Member' }])
  })

  it('IMPORT-XLSX-014: email domain is the deduplication fallback when website is absent', async () => {
    const { db } = useIsolatedDb()
    const buffer = buildWorkbook([
      { company: 'Email Domain First', country: '寰峰浗', email: ' FIRST@EMAIL-DOMAIN.EXAMPLE ' },
      { company: 'Email Domain Duplicate', country: '寰峰浗', email: 'second@email-domain.example' }
    ])

    const result = await importHandler({
      __parts: [{ name: 'file', filename: 'email-domain.xlsx', data: buffer }]
    } as any)
    const customer = db.prepare(`SELECT * FROM customers WHERE domain = 'email-domain.example' AND country = '寰峰浗'`).get() as any
    const contact = db.prepare('SELECT * FROM contacts WHERE customer_id = ?').get(customer.id) as any

    expect(result).toMatchObject({ created: 1, skipped: 1, total: 2 })
    expect(customer.name).toBe('Email Domain First')
    expect(contact.email_normalized).toBe('first@email-domain.example')
  })

  it('IMPORT-XLSX-015: 5MB 整与 5MB-1 byte 边界都通过（仅 5MB+1 拒绝）', async () => {
    const { db } = useIsolatedDb()
    const before = Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)

    // 5MB - 1 byte
    const fiveMinus1 = Buffer.alloc(5 * 1024 * 1024 - 1, 0x20)
    const r1 = await importHandler({
      __parts: [{ name: 'file', filename: 'almost-5mb.bin', data: fiveMinus1 }]
    } as any)
    expect(r1).toMatchObject({ ok: true, created: 0, skipped: 0, total: 0 })
    expect(Number((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as any).count)).toBe(before)

    // 5MB 整
    const exact5mb = Buffer.alloc(5 * 1024 * 1024, 0x20)
    const r2 = await importHandler({
      __parts: [{ name: 'file', filename: 'exact-5mb.bin', data: exact5mb }]
    } as any)
    expect(r2).toMatchObject({ ok: true })

    // 5MB + 1 byte（IMPORT-XLSX-004 已测，这里只确认相对次序）
    const fivePlus1 = Buffer.alloc(5 * 1024 * 1024 + 1, 0x20)
    await expect(importHandler({
      __parts: [{ name: 'file', filename: 'over-5mb.bin', data: fivePlus1 }]
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: expect.stringMatching(/5 MB|不得超过/)
    })
  })

  it('IMPORT-XLSX-016: 200 行精确边界通过，201 行第 201 个被截断', async () => {
    const { db } = useIsolatedDb()
    const rows = Array.from({ length: 201 }, (_, index) => ({
      company: `Edge Customer ${index + 1}`,
      country: '边界国',
      member_id: `EDGE-${String(index + 1).padStart(3, '0')}`
    }))
    const buffer = buildWorkbook(rows)

    const result = await importHandler({
      __parts: [{ name: 'file', filename: 'edge-201.xlsx', data: buffer }]
    } as any)

    expect(result).toMatchObject({ created: 200, skipped: 0, total: 201 })
    expect(db.prepare(`SELECT id FROM customers WHERE source_ref = 'EDGE-200'`).get()).toBeTruthy()
    expect(db.prepare(`SELECT id FROM customers WHERE source_ref = 'EDGE-201'`).get()).toBeUndefined()
    expect(Number((db.prepare(`SELECT COUNT(*) AS count FROM customers WHERE source_ref LIKE 'EDGE-%'`).get() as any).count)).toBe(200)
  })

  it('IMPORT-XLSX-017: member_id 重复优先于 domain+country 重复（显式优先级）', async () => {
    // 第一行：member_id=PRIO-001，domain=prio.example，country=美国
    // 第二行：member_id=PRIO-002，domain=prio.example，country=美国（不同 member_id → 应创建第二行）
    // 第三行：member_id=PRIO-001（与第一行同 member_id → 跳过；虽然 domain/country 也匹配）
    // 第四行：domain=prio.example，country=美国，无 member_id（与第一/二行 domain+country 匹配 → 跳过）
    const { db } = useIsolatedDb()
    const buffer = buildWorkbook([
      { company: 'Priority One', country: '美国', website: 'https://prio.example', email: 'one@prio.example', member_id: 'PRIO-001' },
      { company: 'Priority Two', country: '美国', website: 'https://prio.example/path', email: 'two@prio.example', member_id: 'PRIO-002' },
      { company: 'Duplicate Member', country: '美国', website: 'https://prio.example/x', member_id: 'PRIO-001' },
      { company: 'Duplicate Domain Country', country: '美国', website: 'https://prio.example/y' }
    ])

    const result = await importHandler({
      __parts: [{ name: 'file', filename: 'priority.xlsx', data: buffer }]
    } as any)

    expect(result).toMatchObject({ created: 2, skipped: 2, total: 4 })
    const names = (db.prepare(`SELECT name, source_ref FROM customers WHERE domain = 'prio.example' ORDER BY name`).all() as any[]).map(r => r.name)
    expect(names).toEqual(['Priority One', 'Priority Two'])
  })

  it('IMPORT-XLSX-018: 同一公司名 + 不同 member_id 视为不同客户（不去重 company 自身）', async () => {
    const { db } = useIsolatedDb()
    const buffer = buildWorkbook([
      { company: 'Same Name Co', country: '泰国', member_id: 'SAME-001', website: 'https://same-1.example' },
      { company: 'Same Name Co', country: '泰国', member_id: 'SAME-002', website: 'https://same-2.example' },
      { company: '   Same Name Co   ', country: '泰国', member_id: 'SAME-003' }
    ])

    const result = await importHandler({
      __parts: [{ name: 'file', filename: 'same-name.xlsx', data: buffer }]
    } as any)

    expect(result).toMatchObject({ created: 3, skipped: 0, total: 3 })
    const names = (db.prepare(`SELECT name FROM customers WHERE country = '泰国' AND name LIKE '%Same Name Co%' ORDER BY source_ref`).all() as any[]).map(r => r.name)
    expect(names).toEqual(['Same Name Co', 'Same Name Co', 'Same Name Co'])
    // 第三行的 name 应该是 trim 后的（write 前已 String().trim()）
    const trimmed = (db.prepare(`SELECT name FROM customers WHERE source_ref = 'SAME-003'`).get() as any).name
    expect(trimmed).toBe('Same Name Co')
  })

  it('IMPORT-XLSX-020: 缺 domain/country 的行 → 跳过去重并正常创建（覆盖 customers.post L40 `domain && country ? : null` 兜底）', async () => {
    // 真不变量（fresh coverage 10:28 实测 customers.post.ts L40 branch 为 0 覆盖）：
    // 当 sourceRef 空 且 (domain 为空 或 country 为空) → 不查去重 → 正常 create。
    // 业务期望："无标识就不去重"，避免误判漏建。
    const { db } = useIsolatedDb()
    const buffer = buildWorkbook([
      { company: 'No Identifiers Co' } // 无 member_id / website / email / country → domain='', country=''
    ])

    const result = await importHandler({
      __parts: [{ name: 'file', filename: 'no-identifiers.xlsx', data: buffer }]
    } as any)

    expect(result).toMatchObject({ created: 1, skipped: 0, total: 1 })
    const customer = db.prepare(`SELECT * FROM customers WHERE name = 'No Identifiers Co'`).get() as any
    expect(customer).toBeTruthy()
    expect(customer.domain).toBe('')
    expect(customer.country).toBe('')
  })
})
