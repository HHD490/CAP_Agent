import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import actionHandler from '../../server/api/demo/action.post'
import nodemailer from 'nodemailer'
import { newId } from '../../server/utils/db'

/**
 * demo/action.post.ts 剩余未覆盖分支的合同级测试。
 *
 * 已有覆盖（demo-actions-workflow.test.ts + demo-action-stale.test.ts）：
 *   - accept_profile / accept_match / set_contact / set_focus / update_* 主体
 *   - confirm_next_action 成功 + 部分更新语义
 *   - send_email 白名单 / SMTP 缺配置 / 草稿不存在
 *   - simulate_reply / assign_owner / close / reopen / manual_customer / sync_wca 主体
 *   - 未知 action / 缺 action
 *
 * 本文件补：
 *   - update_customer / update_product / confirm_next_action / close_opportunity 各自 404
 *   - bodySchema zod 边界：data 不是对象（数组、字符串）、id 类型错、action 缺省空
 *   - accept_match 跨客户绑定 contact → 防御（拒绝）
 *   - send_email 成功路径（mock nodemailer）+ recipient 默认值回退 + 受控变更（data.subject/body）
 *   - manual_customer：domain 全空（无 website 无 email）→ 客户仍写入，domain=''
 *
 * 风险依据：release-regression-gatekeeper 阶段 6（异常响应）；test-scope NFR 完整性。
 */

const now = '2026-07-17T02:00:00.000Z'

// —— mock nodemailer 以让 send_email 走完真正的 sendMail 路径 ——
const originalCreateTransport = nodemailer.createTransport
let lastSentInfo: { to: string, from: string, subject: string, text: string } | null = null

beforeEach(() => {
  lastSentInfo = null
  // 让 setup.ts 的 smtpHost/User/Pass/From 看起来是"已配置"
  ;(globalThis as any).useRuntimeConfig = () => ({
    databasePath: './data/acquisition-demo.sqlite',
    llmProvider: 'openai-compatible',
    llmBaseUrl: 'http://127.0.0.1:9',
    llmApiKey: 'test-key-not-real',
    llmModel: 'test-model',
    llmThinkingMode: 'disabled',
    llmReasoningEffort: 'high',
    llmContextWindowTokens: 128000,
    llmModelMaxOutputTokens: 32768,
    llmMaxOutputTokens: 4096,
    llmTimeoutMs: 1000,
    llmMaxRetries: 0,
    llmTemperature: 0.1,
    smtpHost: 'smtp.test.example',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: 'test-user',
    smtpPass: 'test-pass',
    smtpFrom: 'poC@test.example',
    emailAllowlist: 'test@example.com,partner@example.com',
    public: { appBaseUrl: 'http://127.0.0.1:3100' }
  })
  // 替换 nodemailer.createTransport，发送时不真的连 SMTP
  ;(nodemailer as any).createTransport = (_opts: any) => ({
    sendMail: async (mailOptions: any) => {
      lastSentInfo = {
        to: String(mailOptions.to || ''),
        from: String(mailOptions.from || ''),
        subject: String(mailOptions.subject || ''),
        text: String(mailOptions.text || '')
      }
      return { messageId: `<mock-${Date.now()}@test.example>` }
    }
  })
})

afterEach(() => {
  ;(nodemailer as any).createTransport = originalCreateTransport
})

describe('DEMO-RESID: 404 路径补全（update / close / confirm_next_action）', () => {
  it('RES-404-001: update_customer 不存在 → 404', async () => {
    useIsolatedDb()
    await expect(actionHandler({ __body: { action: 'update_customer', id: 'customer-nope', data: { facts: { x: 1 } } } } as any))
      .rejects.toMatchObject({ statusCode: 404, statusMessage: expect.stringMatching(/客户/) })
  })

  it('RES-404-002: update_product 不存在 → 404', async () => {
    useIsolatedDb()
    await expect(actionHandler({ __body: { action: 'update_product', id: 'product-nope', data: { marketing: { x: 1 } } } } as any))
      .rejects.toMatchObject({ statusCode: 404, statusMessage: expect.stringMatching(/产品/) })
  })

  it('RES-404-003: confirm_next_action 不存在 → 404', async () => {
    useIsolatedDb()
    await expect(actionHandler({ __body: { action: 'confirm_next_action', id: 'opp-nope', data: { nextAction: 'x' } } } as any))
      .rejects.toMatchObject({ statusCode: 404, statusMessage: expect.stringMatching(/机会/) })
  })

  it('RES-404-004: close_opportunity 不存在 → 404', async () => {
    useIsolatedDb()
    await expect(actionHandler({ __body: { action: 'close_opportunity', id: 'opp-nope', data: { reason: '无效' } } } as any))
      .rejects.toMatchObject({ statusCode: 404, statusMessage: expect.stringMatching(/机会/) })
  })
})

describe('DEMO-RESID: bodySchema zod 边界', () => {
  it('RES-ZOD-001: action 缺省 → throws (zod)', async () => {
    useIsolatedDb()
    await expect(actionHandler({ __body: { id: 'x' } } as any)).rejects.toThrow()
  })

  it('RES-ZOD-002: action 为非字符串（数字）→ throws (zod)', async () => {
    useIsolatedDb()
    await expect(actionHandler({ __body: { action: 123 } } as any)).rejects.toThrow()
  })

  it('RES-ZOD-003: data 为字符串 → throws (zod 要求 record)', async () => {
    useIsolatedDb()
    await expect(actionHandler({ __body: { action: 'close_opportunity', id: 'opp-01', data: 'oops' } } as any)).rejects.toThrow()
  })

  it('RES-ZOD-004: data 为数组 → throws (zod 要求 record)', async () => {
    useIsolatedDb()
    await expect(actionHandler({ __body: { action: 'close_opportunity', id: 'opp-01', data: [1, 2, 3] } } as any)).rejects.toThrow()
  })

  it('RES-ZOD-005: data 缺省 → 默认 {}（不抛）', async () => {
    useIsolatedDb()
    // 任何能接受 data={} 的 action 都行；选 set_focus
    await expect(actionHandler({ __body: { action: 'set_focus', id: 'opp-nope' } } as any))
      .rejects.toMatchObject({ statusCode: 404 }) // 不是 zod 错误，是 404
  })
})

describe('DEMO-RESID: accept_match 跨客户绑定防御', () => {
  it('RES-MATCH-001: contact 属于其它 customer → 该 contact 不会被绑到当前 opportunity（防御 SQL 类型篡改）', async () => {
    const { db } = useIsolatedDb()
    // contact-wca-02 属于 customer-wca-02；opp-01 属于 customer-wca-01
    const opp = db.prepare(`SELECT customer_id FROM opportunities WHERE id = 'opp-01'`).get() as any
    const crossContact = db.prepare(`SELECT customer_id FROM contacts WHERE id = 'contact-wca-02'`).get() as any
    expect(opp.customer_id).toBe('customer-wca-01')
    expect(crossContact.customer_id).toBe('customer-wca-02')

    // 用 product-sim010 避免 UNIQUE 冲突
    const matchId = newId('match')
    db.prepare(`INSERT INTO match_results
      (id, customer_id, product_id, score, confidence, evidence_json, risks_json, missing_json, blockers_json,
       customer_version, product_version, stale, status, created_at, updated_at)
      VALUES (?, 'customer-wca-01', 'product-sim010', 80, 'high', '[]', '[]', '[]', '[]', 1, 1, 0, 'proposed', ?, ?)`)
      .run(matchId, now, now)

    // data.contactId 来自其它客户 → accept_match 内的 contact 查询带 customer_id 过滤，应查不到
    const result = await actionHandler({
      __body: { action: 'accept_match', id: matchId, data: { contactId: 'contact-wca-02' } }
    } as any)
    expect(result.ok).toBe(true)
    expect(result.task).toBeNull() // contactId 无效，不触发建联

    // 检查 opportunity 没被错误绑到其它客户的 contact
    const oppAfter = db.prepare(`SELECT contact_id FROM opportunities WHERE id = ?`).get(result.opportunityId) as any
    expect(oppAfter.contact_id).not.toBe('contact-wca-02')
    expect(String(oppAfter.contact_id)).toBe('') // validContact=false，contact_id 置空
  })
})

describe('DEMO-RESID: send_email 成功路径（mock nodemailer）', () => {
  it('RES-EMAIL-OK-001: 白名单 + SMTP 已配 → 真实 sendMail 走通，邮件 status=sent, 阶段>=6', async () => {
    const { db } = useIsolatedDb()
    // 把 opp-01 设为 stage 4 以观察 stage 被提升
    db.prepare(`UPDATE opportunities SET stage = 4 WHERE id = 'opp-01'`).run()

    const result = await actionHandler({
      __body: { action: 'send_email', id: 'draft-opp01-zh', data: { recipient: 'partner@example.com' } }
    } as any)
    expect(result.ok).toBe(true)
    expect((result as any).messageId).toMatch(/^<mock-/)

    // lastSentInfo 必被填充
    expect(lastSentInfo).not.toBeNull()
    expect(lastSentInfo!.to).toBe('partner@example.com')
    expect(lastSentInfo!.from).toBe('poC@test.example')

    // DB 落库：draft status=sent
    const draft = db.prepare(`SELECT status, recipient, sent_at FROM email_drafts WHERE id = 'draft-opp01-zh'`).get() as any
    expect(draft.status).toBe('sent')
    expect(draft.recipient).toBe('partner@example.com')
    expect(String(draft.sent_at).length).toBeGreaterThan(0)

    // opportunity 阶段被提升，due_at 已设
    const opp = db.prepare(`SELECT stage, next_action, due_at, blocker FROM opportunities WHERE id = 'opp-01'`).get() as any
    expect(Number(opp.stage)).toBeGreaterThanOrEqual(6)
    expect(String(opp.next_action)).toMatch(/客户回复|跟进/)
    expect(String(opp.due_at).length).toBeGreaterThan(0)
    expect(opp.blocker).toBe('')

    // email_sent 事件写入
    const evt = db.prepare(`SELECT * FROM opportunity_events WHERE opportunity_id = 'opp-01' AND type = 'email_sent'`).get() as any
    expect(evt).toBeTruthy()
    expect(evt.source).toBe('human')
  })

  it('RES-EMAIL-OK-002: 不传 data.subject/body → 用 draft 原值', async () => {
    const { db } = useIsolatedDb()
    const before = db.prepare(`SELECT subject, body FROM email_drafts WHERE id = 'draft-opp01-zh'`).get() as any
    expect(before).toBeTruthy()

    await actionHandler({
      __body: { action: 'send_email', id: 'draft-opp01-zh', data: { recipient: 'test@example.com' } }
    } as any)

    expect(lastSentInfo!.subject).toBe(before.subject)
    expect(lastSentInfo!.text).toBe(before.body)
  })

  it('RES-EMAIL-OK-003: data.subject/body 覆盖 draft 内容', async () => {
    useIsolatedDb()
    await actionHandler({
      __body: {
        action: 'send_email',
        id: 'draft-opp01-zh',
        data: { recipient: 'test@example.com', subject: '覆盖主题', body: '覆盖正文' }
      }
    } as any)
    expect(lastSentInfo!.subject).toBe('覆盖主题')
    expect(lastSentInfo!.text).toBe('覆盖正文')
  })

  it('RES-EMAIL-OK-004: 不传 data.recipient → 默认使用 draft.recipient（小写化）', async () => {
    useIsolatedDb()
    // draft-opp01-zh 的 recipient 在种子里是 'test@example.com'
    // 把 allowlist 加上 'TEST@example.com'（大写）以验证小写化
    const baseConfig = (globalThis as any).useRuntimeConfig()
    ;(globalThis as any).useRuntimeConfig = () => ({
      ...baseConfig,
      emailAllowlist: 'TEST@example.com'
    })

    await actionHandler({
      __body: { action: 'send_email', id: 'draft-opp01-zh' }
    } as any)

    expect(lastSentInfo).not.toBeNull()
    expect(lastSentInfo!.to).toBe('test@example.com')
  })
})

describe('DEMO-RESID: manual_customer 边界', () => {
  it('RES-MANUAL-001: 没传 website 也没传 email → domain=""（仍写客户，不抛错）', async () => {
    const { db } = useIsolatedDb()
    const result = await actionHandler({
      __body: { action: 'manual_customer', data: { name: '裸客户' } }
    } as any)
    expect(result.ok).toBe(true)
    const customer = db.prepare(`SELECT domain FROM customers WHERE id = ?`).get(result.customerId!) as any
    expect(customer.domain).toBe('')
  })

  it('RES-MANUAL-002: 仅 email（无 website）→ domain 取 email @ 后段', async () => {
    const { db } = useIsolatedDb()
    const result = await actionHandler({
      __body: { action: 'manual_customer', data: { name: '邮箱客户', email: 'buyer@acme.example' } }
    } as any)
    const customer = db.prepare(`SELECT domain FROM customers WHERE id = ?`).get(result.customerId!) as any
    expect(customer.domain).toBe('acme.example')
  })

  it('RES-MANUAL-003: 传空白字符串 email → 跳过 contact 插入', async () => {
    const { db } = useIsolatedDb()
    const result = await actionHandler({
      __body: { action: 'manual_customer', data: { name: '空白邮箱客户', email: '   ' } }
    } as any)
    expect(result.ok).toBe(true)
    const contact = db.prepare(`SELECT * FROM contacts WHERE customer_id = ?`).get(result.customerId!) as any
    expect(contact).toBeFalsy()
  })
})
