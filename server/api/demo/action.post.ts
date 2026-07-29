import nodemailer from 'nodemailer'
import { z } from 'zod'
import { getDb, demoNow, addEvent, newId } from '../../utils/db'
import { isValidOutreachContact } from '../../utils/contact'
import { createAgentTask } from '../../utils/agent'

const bodySchema = z.object({
  action: z.string(),
  id: z.string().optional().default(''),
  data: z.record(z.string(), z.any()).optional().default({})
})

export default defineEventHandler(async (event) => {
  const { action, id, data } = bodySchema.parse(await readBody(event))
  const db = getDb()
  const now = demoNow(db)

  if (action === 'accept_profile') {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any
    if (!customer) throw createError({ statusCode: 404, statusMessage: '客户不存在' })
    const profile = JSON.parse(customer.ai_profile_json || '{}')
    const facts = { ...JSON.parse(customer.facts_json || '{}'), confirmedAiProfile: profile, confirmedAt: now }
    db.prepare(`UPDATE customers SET facts_json = ?, ai_profile_status = 'confirmed', updated_at = ? WHERE id = ?`).run(JSON.stringify(facts), now, id)
    addEvent({ customerId: id, type: 'profile_confirmed', title: 'AI 画像已由人工确认', description: '确认后的画像字段已进入标准化事实层。', source: 'human' }, db)
    return { ok: true }
  }

  if (action === 'accept_match') {
    const match = db.prepare('SELECT * FROM match_results WHERE id = ?').get(id) as any
    if (!match) throw createError({ statusCode: 404, statusMessage: '匹配结果不存在' })
    const hardBlockers = JSON.parse(match.blockers_json || '[]')
    if (hardBlockers.length && !data.overrideBlockers) throw createError({ statusCode: 400, statusMessage: '存在硬阻断项，请确认后再接受匹配' })
    const contactId = String(data.contactId || '')
    const contact = contactId ? db.prepare('SELECT * FROM contacts WHERE id = ? AND customer_id = ?').get(contactId, match.customer_id) as any : null
    const validContact = isValidOutreachContact(contact)
    const existing = db.prepare(`SELECT * FROM opportunities WHERE customer_id = ? AND product_id = ? AND status IN ('active', 'handed_off') LIMIT 1`).get(match.customer_id, match.product_id) as any
    let opportunityId = existing?.id
    if (!existing) {
      opportunityId = newId('opp')
      db.prepare(`INSERT INTO opportunities
        (id, customer_id, product_id, contact_id, source, stage, status, focus, owner, next_action, due_at, blocker, stale_review,
         close_reason, ai_summary, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', 4, 'active', 1, '', ?, ?, ?, 0, '', '', ?, ?)`)
        .run(opportunityId, match.customer_id, match.product_id, validContact ? contactId : '', validContact ? '等待 Agent 生成建联内容' : '补充有效联系人', now,
          validContact ? '' : '缺少可用于建联的有效联系人', now, now)
      db.prepare('UPDATE opportunities SET focus = 0 WHERE customer_id = ? AND id <> ?').run(match.customer_id, opportunityId)
    } else {
      db.prepare(`UPDATE opportunities SET stage = MAX(stage, 4), contact_id = ?, blocker = ?, next_action = ?, updated_at = ? WHERE id = ?`)
        .run(validContact ? contactId : existing.contact_id || '', validContact ? '' : existing.blocker || '缺少可用于建联的有效联系人',
          validContact ? '等待 Agent 生成建联内容' : '补充有效联系人', now, opportunityId)
    }
    db.prepare(`UPDATE match_results SET status = 'accepted', stale = 0, updated_at = ? WHERE id = ?`).run(now, id)
    addEvent({ opportunityId, customerId: match.customer_id, type: 'match_accepted', title: '人工接受产品匹配', description: validContact ? '获客机会已创建，已自动启动建联内容生成。' : '获客机会已创建，补充有效联系人后才能生成建联内容。', source: 'human', data: { matchId: id } }, db)
    const task = validContact ? createAgentTask('outreach_drafting', 'opportunity', opportunityId, { language: 'zh', triggeredBy: 'accept_match' }) : null
    return { ok: true, opportunityId, task }
  }

  if (action === 'set_contact') {
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as any
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ? AND customer_id = ?').get(String(data.contactId || ''), opportunity?.customer_id || '') as any
    if (!opportunity || !contact) throw createError({ statusCode: 404, statusMessage: '机会或联系人不存在' })
    if (!isValidOutreachContact(contact)) throw createError({ statusCode: 400, statusMessage: '请选择状态为“可联系”且有邮箱的联系人' })
    db.prepare(`UPDATE opportunities SET contact_id = ?, blocker = '', next_action = '等待 Agent 生成建联内容', updated_at = ? WHERE id = ?`).run(contact.id, now, id)
    addEvent({ opportunityId: id, customerId: opportunity.customer_id, type: 'contact_selected', title: '已选择建联联系人', description: `${contact.name} · ${contact.email}`, source: 'human' }, db)
    return { ok: true, task: createAgentTask('outreach_drafting', 'opportunity', id, { language: 'zh', triggeredBy: 'contact_selected' }) }
  }

  if (action === 'set_focus') {
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as any
    if (!opportunity) throw createError({ statusCode: 404, statusMessage: '机会不存在' })
    db.prepare('UPDATE opportunities SET focus = 0 WHERE customer_id = ?').run(opportunity.customer_id)
    db.prepare('UPDATE opportunities SET focus = 1, updated_at = ? WHERE id = ?').run(now, id)
    return { ok: true }
  }

  if (action === 'update_customer') {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as any
    if (!customer) throw createError({ statusCode: 404, statusMessage: '客户不存在' })
    const facts = { ...JSON.parse(customer.facts_json || '{}'), ...(data.facts || {}), updatedBy: '模拟操作者' }
    const nextVersion = customer.profile_version + 1
    db.prepare(`UPDATE customers SET facts_json = ?, profile_version = ?, ai_profile_status = 'pending', updated_at = ?, last_activity_at = ? WHERE id = ?`)
      .run(JSON.stringify(facts), nextVersion, now, now, id)
    db.prepare(`UPDATE match_results SET stale = 1, updated_at = ? WHERE customer_id = ? AND customer_version < ? AND status <> ?`)
      .run(now, id, nextVersion, 'accepted')
    db.prepare(`UPDATE opportunities SET stale_review = 1, updated_at = ? WHERE customer_id = ? AND status IN ('active', 'handed_off')`).run(now, id)
    addEvent({ customerId: id, type: 'customer_updated', title: '客户资料已更新', description: `画像版本已更新为 V${nextVersion}，旧匹配已标记待重算。`, source: 'human' }, db)
    return { ok: true, version: nextVersion }
  }

  if (action === 'update_product') {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any
    if (!product) throw createError({ statusCode: 404, statusMessage: '产品不存在' })
    const marketing = { ...JSON.parse(product.marketing_json || '{}'), ...(data.marketing || {}), updatedBy: '模拟操作者' }
    const nextVersion = product.product_version + 1
    db.prepare(`UPDATE products SET marketing_json = ?, product_version = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(marketing), nextVersion, now, id)
    db.prepare(`UPDATE match_results SET stale = 1, updated_at = ? WHERE product_id = ? AND product_version < ? AND status <> ?`)
      .run(now, id, nextVersion, 'accepted')
    db.prepare(`UPDATE opportunities SET stale_review = 1, updated_at = ? WHERE product_id = ? AND status IN ('active', 'handed_off')`).run(now, id)
    return { ok: true, version: nextVersion }
  }

  if (action === 'confirm_next_action') {
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as any
    if (!opportunity) throw createError({ statusCode: 404, statusMessage: '机会不存在' })
    db.prepare('UPDATE opportunities SET next_action = ?, due_at = ?, owner = ?, blocker = ?, updated_at = ? WHERE id = ?')
      .run(String(data.nextAction || opportunity.next_action), String(data.dueAt || opportunity.due_at), String(data.owner ?? opportunity.owner), String(data.blocker ?? opportunity.blocker), now, id)
    addEvent({ opportunityId: id, customerId: opportunity.customer_id, type: 'next_action_confirmed', title: '下一步动作已确认', description: String(data.nextAction || opportunity.next_action), source: 'human' }, db)
    return { ok: true }
  }

  if (action === 'send_email') {
    const draft = db.prepare('SELECT * FROM email_drafts WHERE id = ?').get(id) as any
    if (!draft) throw createError({ statusCode: 404, statusMessage: '邮件草稿不存在' })
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(draft.opportunity_id) as any
    const config = useRuntimeConfig()
    const recipient = String(data.recipient || draft.recipient || '').trim().toLowerCase()
    const allowlist = String(config.emailAllowlist || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean)
    if (!allowlist.includes(recipient)) throw createError({ statusCode: 400, statusMessage: '收件地址不在 EMAIL_ALLOWLIST 白名单中' })
    if (!config.smtpHost || !config.smtpUser || !config.smtpPass || !config.smtpFrom) throw createError({ statusCode: 400, statusMessage: 'SMTP 尚未完整配置，本次没有发送或伪造发送记录' })
    const transport = nodemailer.createTransport({
      host: String(config.smtpHost), port: Number(config.smtpPort), secure: Boolean(config.smtpSecure),
      auth: { user: String(config.smtpUser), pass: String(config.smtpPass) }
    })
    const info = await transport.sendMail({ from: String(config.smtpFrom), to: recipient, subject: String(data.subject || draft.subject), text: String(data.body || draft.body) })
    db.prepare(`UPDATE email_drafts SET subject = ?, body = ?, recipient = ?, status = 'sent', sent_at = ? WHERE id = ?`)
      .run(String(data.subject || draft.subject), String(data.body || draft.body), recipient, now, id)
    const due = new Date(now)
    due.setUTCDate(due.getUTCDate() + 3)
    db.prepare(`UPDATE opportunities SET stage = MAX(stage, 6), next_action = '等待客户回复；到期后人工审核首次跟进', due_at = ?, blocker = '', updated_at = ? WHERE id = ?`)
      .run(due.toISOString(), now, opportunity.id)
    addEvent({ opportunityId: opportunity.id, customerId: opportunity.customer_id, type: 'email_sent', title: '建联邮件已发送', description: `已通过白名单 SMTP 发送至 ${recipient}`, source: 'human', data: { messageId: info.messageId } }, db)
    return { ok: true, messageId: info.messageId }
  }

  if (action === 'simulate_reply') {
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as any
    if (!opportunity) throw createError({ statusCode: 404, statusMessage: '机会不存在' })
    const replyText = String(data.replyText || '我们下周有一票货，请提供具体报价并安排电话沟通。').trim()
    db.prepare(`UPDATE opportunities SET stage = MAX(stage, 7), next_action = '等待 Agent 分析客户回复', blocker = '', updated_at = ? WHERE id = ?`).run(now, id)
    addEvent({ opportunityId: id, customerId: opportunity.customer_id, type: 'reply_received', title: '收到客户回复（模拟）', description: replyText, source: 'email' }, db)
    return { ok: true, task: createAgentTask('reply_qualification', 'opportunity', id, { replyText }) }
  }

  if (action === 'assign_owner') {
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as any
    if (!opportunity) throw createError({ statusCode: 404, statusMessage: '机会不存在' })
    if (opportunity.stage < 8) throw createError({ statusCode: 400, statusMessage: '只有明确意向机会才能分配负责人' })
    const owner = String(data.owner || '负责人 A')
    db.prepare(`UPDATE opportunities SET stage = 9, status = 'handed_off', owner = ?, next_action = '负责人确认首次沟通安排', due_at = ?, blocker = '', updated_at = ? WHERE id = ?`).run(owner, now, now, id)
    addEvent({ opportunityId: id, customerId: opportunity.customer_id, type: 'owner_assigned', title: '已分配负责人', description: `${owner} 已接手该机会。`, source: 'human' }, db)
    return { ok: true, task: createAgentTask('handoff_summary', 'opportunity', id, { owner }) }
  }

  if (action === 'close_opportunity') {
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as any
    const reason = String(data.reason || '').trim()
    if (!opportunity) throw createError({ statusCode: 404, statusMessage: '机会不存在' })
    if (!reason) throw createError({ statusCode: 400, statusMessage: '关闭机会必须填写原因' })
    db.prepare(`UPDATE opportunities SET status = ?, close_reason = ?, next_action = '', due_at = '', updated_at = ? WHERE id = ?`)
      .run(reason === '暂缓' ? 'paused' : 'closed', reason, now, id)
    addEvent({ opportunityId: id, customerId: opportunity.customer_id, type: 'opportunity_closed', title: reason === '暂缓' ? '机会已暂停' : '机会已关闭', description: reason, source: 'human' }, db)
    return { ok: true }
  }

  if (action === 'reopen_opportunity') {
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as any
    if (!opportunity) throw createError({ statusCode: 404, statusMessage: '机会不存在' })
    if (opportunity.close_reason === '禁止联系') throw createError({ statusCode: 400, statusMessage: '禁止联系状态不可直接重开' })
    db.prepare(`UPDATE opportunities SET status = 'active', close_reason = '', next_action = '人工检查最新客户信号', due_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id)
    addEvent({ opportunityId: id, customerId: opportunity.customer_id, type: 'opportunity_reopened', title: '机会已重新开启', source: 'human' }, db)
    return { ok: true }
  }

  if (action === 'manual_customer') {
    const name = String(data.name || '').trim()
    const country = String(data.country || '').trim()
    const city = String(data.city || '').trim()
    const website = String(data.website || '').trim()
    const email = String(data.email || '').trim().toLowerCase()
    if (!name) throw createError({ statusCode: 400, statusMessage: '请填写客户公司名称' })
    const domain = website.replace(/^https?:\/\//, '').split('/')[0] || email.split('@')[1] || ''
    const customerId = newId('customer-manual')
    db.prepare(`INSERT INTO customers
      (id, name, source, source_ref, country, city, website, domain, customer_type, status, profile_version, raw_json, facts_json,
       ai_profile_json, ai_profile_status, last_activity_at, created_at, updated_at)
      VALUES (?, ?, 'manual', '', ?, ?, ?, ?, 'unknown', 'normal', 1, ?, ?, '{}', 'pending', ?, ?, ?)`)
      .run(customerId, name, country, city, website, domain,
        JSON.stringify({ enteredBy: '模拟操作者', enteredAt: now }), JSON.stringify({ companyName: name, country, city, website }), now, now, now)
    if (email) {
      db.prepare(`INSERT INTO contacts (id, customer_id, name, title, email, email_normalized, status, is_primary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'verify', 1, ?, ?)`)
        .run(newId('contact'), customerId, String(data.contactName || ''), String(data.title || ''), email, email, now, now)
    }
    addEvent({ customerId, type: 'manual_created', title: '手工创建客户档案', description: `${name} 已进入统一客户库。`, source: 'human' }, db)
    return { ok: true, customerId }
  }

  if (action === 'sync_wca') {
    const count = Number((db.prepare(`SELECT COUNT(*) count FROM customers WHERE source = 'wca_simulated'`).get() as any).count)
    const updated = db.prepare(`SELECT id FROM customers WHERE source = 'wca_simulated' ORDER BY id LIMIT 5`).all() as any[]
    for (const row of updated) db.prepare('UPDATE customers SET last_activity_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id)
    let created = 0
    if (count < 33) {
      for (let offset = 0; offset < Math.min(3, 33 - count); offset++) {
        const seq = count + offset + 1
        const customerId = `customer-wca-sync-${seq}`
        const domain = `synced-forwarder-${seq}.example`
        db.prepare(`INSERT INTO customers
          (id, name, source, source_ref, country, city, website, domain, customer_type, status, profile_version, raw_json, facts_json,
           ai_profile_json, ai_profile_status, last_activity_at, created_at, updated_at)
          VALUES (?, ?, 'wca_simulated', ?, '美国', '芝加哥', ?, ?, 'freight_forwarder_partner', 'normal', 1, ?, ?, '{}', 'pending', ?, ?, ?)`)
          .run(customerId, `Synced Demo Freight ${seq}`, `WCA-SIM-${2000 + seq}`, `https://${domain}`, domain,
            JSON.stringify({ simulatedDirectoryListing: true, syncBatch: now }), JSON.stringify({ companyNature: '海外货运代理', serviceCapabilities: ['空运', '海运'] }), now, now, now)
        db.prepare(`INSERT INTO contacts (id, customer_id, name, title, email, email_normalized, status, is_primary, created_at, updated_at)
          VALUES (?, ?, 'Demo Contact', 'Partnership Manager', ?, ?, 'verify', 1, ?, ?)`)
          .run(newId('contact'), customerId, `contact@${domain}`, `contact@${domain}`, now, now)
        created++
      }
    }
    return { ok: true, created, updated: updated.length, note: '这是 PoC 模拟同步，未访问真实 WCA 账号或目录。' }
  }

  throw createError({ statusCode: 400, statusMessage: `不支持的演示动作：${action}` })
})
