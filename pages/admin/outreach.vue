<script setup lang="ts">
import { IconEmail, IconRobot, IconSend } from '@arco-design/web-vue/es/icon'
import type { Opportunity, TimelineEvent } from '../../shared/types'

definePageMeta({ layout: 'admin' })

type ConversationStatus = 'draft' | 'contacted' | 'replied'
type Direction = 'inbound' | 'outbound' | 'system'

interface ConversationMessage {
  id: string
  direction: Direction
  author: string
  body: string
  translation?: string
  time: string
  state?: string
  aiGenerated?: boolean
}

interface ConversationThread {
  id: string
  opportunityId: string
  customerName: string
  productName: string
  country: string
  language: string
  languageLabel: string
  status: ConversationStatus
  statusLabel: string
  subject: string
  recipient: string
  simulated: boolean
  messages: ConversationMessage[]
  composerBody: string
}

const route = useRoute()
const router = useRouter()
const { state, loading } = useDemoState()
const keyword = ref('')
const language = ref('all')
const status = ref('all')
const selectedThreadId = ref('')
const composerLanguage = ref('zh')
const composerBody = ref('')

const demoTemplates: ConversationThread[] = [
  {
    id: 'thread-us', opportunityId: 'opp-01', customerName: 'Atlas 洛杉矶 Logistics', productName: '美国空派标快（含税）',
    country: '美国', language: 'en', languageLabel: 'English', status: 'replied', statusLabel: '客户已回复',
    subject: 'China–US air freight partnership', recipient: 'alex@demo-forwarder-01.example', simulated: true,
    composerBody: 'Hi Alex, thank you for confirming the lane. We can prepare the next-week capacity and partner rate sheet for your review.',
    messages: [
      { id: 'us-1', direction: 'outbound', author: '我方 · AI 辅助', body: 'Hi Alex, based on your strong final-mile coverage in the United States, we would like to explore cooperation on our China–US priority air freight service.', translation: '您好 Alex，基于贵司在美国本地派送方面的优势，我们希望探讨中国至美国空派标快的合作。', time: '07-16 11:00', state: '邮件已送达', aiGenerated: true },
      { id: 'us-2', direction: 'inbound', author: 'Alex · Atlas Logistics', body: 'Thanks for reaching out. Please send your capacity and partner rate sheet for next week. We can schedule a call on Thursday.', translation: '感谢联系。请发送下周舱位和合作价表，我们可以在周四安排电话沟通。', time: '07-17 09:20', state: '客户回复' },
      { id: 'us-3', direction: 'system', author: 'Agent', body: '识别为明确意向：客户提出具体资料要求并主动建议会议时间。', time: '07-17 09:21', state: 'AI 意向判断' }
    ]
  },
  {
    id: 'thread-de', opportunityId: 'opp-05', customerName: 'SwiftBridge 汉堡 Logistics', productName: '欧洲空派经济包税线',
    country: '德国', language: 'de', languageLabel: 'Deutsch', status: 'contacted', statusLabel: '等待回复',
    subject: 'Zusammenarbeit für Luftfracht nach Deutschland', recipient: 'partnership@demo-forwarder-05.example', simulated: true,
    composerBody: 'Guten Tag, wir möchten gemeinsam eine erste Testsendung für unsere Luftfrachtlinie nach Deutschland planen.',
    messages: [
      { id: 'de-1', direction: 'outbound', author: '我方 · AI 辅助', body: 'Guten Tag, aufgrund Ihres starken Zollabfertigungs- und Zustellnetzwerks in Deutschland möchten wir eine Zusammenarbeit für unsere Economy-Luftfrachtlinie prüfen.', translation: '您好，考虑到贵司在德国的清关和派送网络，我们希望评估欧洲空派经济包税线的合作机会。', time: '07-17 08:45', state: '邮件已送达', aiGenerated: true },
      { id: 'de-2', direction: 'outbound', author: '我方跟进', body: 'Gerne senden wir Ihnen eine kurze Leistungsübersicht und schlagen anschließend einen 20-minütigen Austausch vor.', translation: '我们可以先发送简要能力说明，随后安排一次 20 分钟的沟通。', time: '07-18 10:10', state: '跟进邮件' }
    ]
  },
  {
    id: 'thread-jp', opportunityId: 'demo-jp', customerName: 'BlueHarbor 东京 Logistics', productName: '日本空运门到门专线',
    country: '日本', language: 'ja', languageLabel: '日本語', status: 'replied', statusLabel: '客户已回复',
    subject: '中国発・日本向け航空輸送のご提案', recipient: 'sales@blueharbor-tokyo.example', simulated: true,
    composerBody: 'ご返信ありがとうございます。来週火曜日の午後にオンラインミーティングを設定いたします。',
    messages: [
      { id: 'jp-1', direction: 'outbound', author: '我方 · AI 辅助', body: 'ご担当者様、中国発・日本向け航空輸送について、貴社の通関・配送ネットワークと連携できる可能性をご相談させてください。', translation: '您好，我们希望就中国至日本空运业务，探讨与贵司清关及派送网络合作的可能性。', time: '07-15 14:30', state: 'メール送信済み', aiGenerated: true },
      { id: 'jp-2', direction: 'inbound', author: '佐藤様 · BlueHarbor', body: 'ご連絡ありがとうございます。越境EC貨物の月間ボリュームと想定リードタイムを教えてください。来週の打ち合わせも可能です。', translation: '感谢联系。请告知跨境电商货物的月度货量和预计时效，下周也可以安排会议。', time: '07-16 09:05', state: '客户回复' },
      { id: 'jp-3', direction: 'system', author: 'Agent', body: '识别为明确意向：客户询问月度货量与时效，并同意安排会议。', time: '07-16 09:06', state: 'AI 意向判断' }
    ]
  },
  {
    id: 'thread-es', opportunityId: 'demo-es', customerName: 'CargoVista 巴塞罗那 Logistics', productName: '欧洲海运拼箱协同产品',
    country: '西班牙', language: 'es', languageLabel: 'Español', status: 'draft', statusLabel: '待审核',
    subject: 'Propuesta de colaboración para carga LCL', recipient: 'maria@cargovista-barcelona.example', simulated: true,
    composerBody: 'Hola María, nos gustaría explorar una colaboración para nuestros envíos LCL desde China hacia España y el sur de Europa.',
    messages: [
      { id: 'es-1', direction: 'outbound', author: 'Agent 草稿', body: 'Hola María, hemos visto la cobertura de CargoVista en Barcelona y creemos que existe una buena oportunidad para colaborar en nuestros envíos LCL desde China.', translation: '您好 María，我们了解到 CargoVista 在巴塞罗那的服务覆盖，希望探讨中国出口海运拼箱方面的合作机会。', time: '07-20 10:15', state: '待人工审核', aiGenerated: true },
      { id: 'es-2', direction: 'system', author: 'Agent', body: '已按西班牙语商务邮件习惯完成本地化，并保留单一行动号召。', time: '07-20 10:15', state: '本地化完成' }
    ]
  }
]

function messageFromEvent(event: TimelineEvent): ConversationMessage | null {
  if (event.type !== 'reply_received') return null
  return { id: event.id, direction: 'inbound', author: '客户联系人', body: event.description, time: shortDate(event.createdAt), state: '客户回复' }
}

function shortDate(value?: string) {
  return value ? value.slice(5, 16).replace('T', ' ') : '—'
}

function buildActualThread(opportunity: Opportunity): ConversationThread {
  const messages: ConversationMessage[] = []
  for (const draft of [...(opportunity.drafts || [])].reverse()) {
    messages.push({
      id: draft.id,
      direction: 'outbound',
      author: draft.status === 'sent' ? '我方' : 'Agent 草稿',
      body: draft.body,
      time: shortDate(draft.sentAt || draft.createdAt),
      state: draft.status === 'sent' ? '邮件已送达' : '待人工审核',
      aiGenerated: draft.status !== 'sent'
    })
  }
  for (const event of opportunity.events || []) {
    const message = messageFromEvent(event)
    if (message) messages.push(message)
  }
  const latestDraft = opportunity.drafts?.[0]
  const hasReply = messages.some(item => item.direction === 'inbound')
  return {
    id: `thread-${opportunity.id}`,
    opportunityId: opportunity.id,
    customerName: opportunity.customer?.name || '未命名客户',
    productName: opportunity.product?.name || '待确认产品',
    country: opportunity.customer?.country || '未知国家',
    language: latestDraft?.language || 'zh',
    languageLabel: latestDraft?.language === 'en' ? 'English' : '中文',
    status: hasReply ? 'replied' : latestDraft?.status === 'sent' ? 'contacted' : 'draft',
    statusLabel: hasReply ? '客户已回复' : latestDraft?.status === 'sent' ? '等待回复' : '待审核',
    subject: latestDraft?.subject || '等待 Agent 生成建联主题',
    recipient: latestDraft?.recipient || opportunity.contact?.email || '尚未选择联系人',
    simulated: true,
    messages,
    composerBody: latestDraft?.body || 'Agent 尚未生成建联内容。请先补充有效联系人或运行建联内容 Agent。'
  }
}

const allThreads = computed<ConversationThread[]>(() => {
  const actual = (state.value?.opportunities || []).map(opportunity => {
    const template = demoTemplates.find(item => item.opportunityId === opportunity.id)
    if (!template) return buildActualThread(opportunity)
    return {
      ...template,
      customerName: opportunity.customer?.name || template.customerName,
      productName: opportunity.product?.name || template.productName,
      country: opportunity.customer?.country || template.country
    }
  })
  const actualIds = new Set(actual.map(item => item.opportunityId))
  return [...actual, ...demoTemplates.filter(item => !actualIds.has(item.opportunityId))]
})

const threads = computed(() => allThreads.value.filter(thread => {
  const key = keyword.value.trim().toLowerCase()
  const keyHit = !key || [thread.customerName, thread.productName, thread.country, thread.subject].join(' ').toLowerCase().includes(key)
  return keyHit && (language.value === 'all' || thread.language === language.value) && (status.value === 'all' || thread.status === status.value)
}))

const selectedThread = computed(() => allThreads.value.find(item => item.id === selectedThreadId.value))
const isReviewFocus = computed(() => route.query.focus === 'review' && route.query.opportunity === selectedThread.value?.opportunityId)

watch([allThreads, () => route.query.opportunity], ([items, opportunityId]) => {
  const routeThread = typeof opportunityId === 'string' ? items.find(item => item.opportunityId === opportunityId) : undefined
  if (routeThread) selectedThreadId.value = routeThread.id
  else if (!items.some(item => item.id === selectedThreadId.value)) selectedThreadId.value = items[0]?.id || ''
}, { immediate: true })

watch(selectedThread, thread => {
  if (!thread) return
  composerLanguage.value = thread.language
  composerBody.value = thread.composerBody
}, { immediate: true })

function selectThread(thread: ConversationThread) {
  selectedThreadId.value = thread.id
  const query = thread.opportunityId.startsWith('demo-') ? {} : { opportunity: thread.opportunityId }
  void router.replace({ query })
}

function statusClass(value: ConversationStatus) {
  return value === 'replied' ? 'success' : value === 'contacted' ? 'info' : 'warning'
}
</script>

<template>
  <div>
    <header class="page-header">
      <div class="page-header__copy">
        <div class="breadcrumbs">智能获客 / 建联工作台</div>
        <h1>邮件建联会话</h1>
        <p>用聊天方式查看邮件往来；每个气泡仍代表一封真实邮件或 Agent 业务判断</p>
      </div>
      <div class="page-header__actions">
        <a-button type="primary" @click="navigateTo('/admin/opportunities')">查看获客机会</a-button>
      </div>
    </header>

    <main class="page-content">
      <a-alert type="info" class="page-section">
        PoC 已预置中文、英文、德语、日语和西班牙语会话。所有往来均为演示记录，不要求操作者真实发送或模拟回复。
      </a-alert>

      <section class="card conversation-filters">
        <a-input-search v-model="keyword" allow-clear placeholder="搜索客户、国家、产品或主题" />
        <div class="field-control">
          <span class="field-label">语言</span>
          <a-select v-model="language">
            <a-option value="all">全部语言</a-option>
            <a-option value="zh">中文</a-option>
            <a-option value="en">English</a-option>
            <a-option value="de">Deutsch</a-option>
            <a-option value="ja">日本語</a-option>
            <a-option value="es">Español</a-option>
          </a-select>
        </div>
        <div class="field-control">
          <span class="field-label">会话状态</span>
          <a-select v-model="status">
            <a-option value="all">全部状态</a-option>
            <a-option value="draft">待审核</a-option>
            <a-option value="contacted">等待回复</a-option>
            <a-option value="replied">客户已回复</a-option>
          </a-select>
        </div>
        <span class="count-label">{{ threads.length }} 个邮件会话</span>
      </section>

      <section class="card conversation-layout">
        <aside class="thread-list">
          <div class="thread-list__title"><strong>建联邮箱</strong><span>{{ threads.length }}</span></div>
          <button
            v-for="thread in threads"
            :key="thread.id"
            :class="['thread-item', { active: thread.id === selectedThreadId }]"
            @click="selectThread(thread)"
          >
            <span class="thread-avatar">{{ thread.customerName.slice(0, 1) }}</span>
            <span class="thread-copy">
              <span class="thread-copy__top"><strong>{{ thread.customerName }}</strong><small>{{ thread.messages.at(-1)?.time || '待开始' }}</small></span>
              <span class="thread-product">{{ thread.productName }}</span>
              <span class="thread-preview">{{ thread.messages.at(-1)?.body || '尚无往来记录' }}</span>
              <span class="thread-tags"><i>{{ thread.country }}</i><i>{{ thread.languageLabel }}</i><i :class="statusClass(thread.status)">{{ thread.statusLabel }}</i></span>
            </span>
          </button>
          <div v-if="!threads.length && !loading" class="empty-state">没有符合筛选条件的会话</div>
        </aside>

        <div v-if="selectedThread" class="chat-panel">
          <header class="chat-header">
            <span class="chat-avatar">{{ selectedThread.customerName.slice(0, 1) }}</span>
            <div>
              <h2>{{ selectedThread.customerName }}</h2>
              <p>{{ selectedThread.productName }} · {{ selectedThread.country }}</p>
            </div>
            <div class="chat-header__meta">
              <span class="semantic-tag neutral"><IconEmail /> Email Thread</span>
              <span class="semantic-tag info">{{ selectedThread.languageLabel }}</span>
              <span :class="['semantic-tag', statusClass(selectedThread.status)]">{{ selectedThread.statusLabel }}</span>
            </div>
          </header>

          <div class="mail-subject">
            <span>主题</span><strong>{{ selectedThread.subject }}</strong><small>收件人：{{ selectedThread.recipient }}</small>
          </div>

          <div class="message-stream">
            <div class="date-divider"><span>演示邮件往来</span></div>
            <article
              v-for="message in selectedThread.messages"
              :key="message.id"
              :class="['message-row', `message-row--${message.direction}`]"
            >
              <span v-if="message.direction !== 'system'" class="message-avatar">{{ message.direction === 'outbound' ? '我' : selectedThread.customerName.slice(0, 1) }}</span>
              <div class="message-bubble">
                <div class="message-bubble__meta">
                  <strong>{{ message.author }}</strong>
                  <span v-if="message.aiGenerated" class="ai-chip"><IconRobot /> AI 生成</span>
                  <time>{{ message.time }}</time>
                </div>
                <p>{{ message.body }}</p>
                <div v-if="message.translation" class="message-translation"><span>AI 中文参考</span>{{ message.translation }}</div>
                <small v-if="message.state" class="message-state">{{ message.state }}</small>
              </div>
            </article>
            <div v-if="!selectedThread.messages.length" class="empty-state">尚无邮件记录，等待 Agent 生成首封建联内容。</div>
          </div>

          <section id="review-composer" :class="['review-composer', { 'review-composer--focus': isReviewFocus }]">
            <div class="review-composer__head">
              <div><span class="ai-kicker"><IconRobot /> HUMAN IN THE LOOP</span><h3>审核并发送建联邮件</h3></div>
              <span class="semantic-tag warning">PoC 仅展示，不实际发送</span>
            </div>
            <a-alert v-if="isReviewFocus" type="success">已从智能匹配定位到该机会，可在这里审核 Agent 生成的建联内容。</a-alert>
            <div class="composer-toolbar">
              <div class="field-control">
                <span class="field-label">发送语言</span>
                <a-select v-model="composerLanguage">
                  <a-option value="zh">中文</a-option>
                  <a-option value="en">English</a-option>
                  <a-option value="de">Deutsch</a-option>
                  <a-option value="ja">日本語</a-option>
                  <a-option value="es">Español</a-option>
                </a-select>
              </div>
              <span>底层渠道：Email · 显示方式：Conversation</span>
            </div>
            <a-textarea v-model="composerBody" :auto-size="{ minRows: 4, maxRows: 8 }" />
            <div class="composer-actions">
              <span>正式版本可在此接入 SMTP、邮件线程 ID 和真实入站邮箱。</span>
              <a-button disabled><template #icon><IconSend /></template>演示模式不实际发送</a-button>
            </div>
          </section>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.conversation-filters { display: grid; grid-template-columns: 1.4fr .7fr .7fr auto; align-items: end; gap: 16px; padding: 16px; margin-bottom: 16px; }
.conversation-layout { min-height: 720px; display: grid; grid-template-columns: 340px minmax(0, 1fr); overflow: hidden; }
.thread-list { border-right: 1px solid var(--color-divider); background: var(--color-bg-surface); overflow: auto; }
.thread-list__title { height: 54px; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--color-divider); background: #fff; }
.thread-list__title span { min-width: 24px; padding: 2px 7px; border-radius: 99px; color: var(--color-primary); background: var(--color-primary-50); text-align: center; }
.thread-item { width: 100%; padding: 14px 14px; display: flex; gap: 11px; border: 0; border-bottom: 1px solid var(--color-divider); color: inherit; background: transparent; text-align: left; cursor: pointer; transition: .15s ease; }
.thread-item:hover { background: #f4f7fb; }.thread-item.active { box-shadow: inset 3px 0 var(--color-primary); background: #ebf3fd; }
.thread-avatar,.chat-avatar,.message-avatar { flex: 0 0 auto; display: grid; place-items: center; border-radius: 10px; color: #fff; background: linear-gradient(135deg, var(--color-primary), var(--color-ai)); }
.thread-avatar { width: 38px; height: 38px; }.thread-copy { min-width: 0; flex: 1; display: grid; gap: 4px; }.thread-copy__top { display: flex; gap: 8px; }.thread-copy__top strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.thread-copy__top small { margin-left: auto; color: var(--color-text-placeholder); white-space: nowrap; }
.thread-product,.thread-preview { overflow: hidden; color: var(--color-text-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.thread-preview { color: var(--color-text-placeholder); }.thread-tags { display: flex; flex-wrap: wrap; gap: 4px; }.thread-tags i { padding: 1px 6px; border-radius: 6px; color: var(--color-text-secondary); background: #fff; font-size: 10px; font-style: normal; }.thread-tags i.success { color: var(--color-success); background: var(--color-success-bg); }.thread-tags i.info { color: var(--color-primary); background: var(--color-primary-50); }.thread-tags i.warning { color: var(--color-warning); background: var(--color-warning-bg); }
.chat-panel { min-width: 0; display: flex; flex-direction: column; background: #fff; }.chat-header { min-height: 72px; padding: 12px 20px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--color-divider); }.chat-avatar { width: 44px; height: 44px; }.chat-header h2,.chat-header p { margin: 0; }.chat-header p { margin-top: 3px; color: var(--color-text-secondary); font-size: 12px; }.chat-header__meta { margin-left: auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.mail-subject { min-height: 44px; padding: 9px 20px; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; border-bottom: 1px solid var(--color-divider); background: #fafbfd; }.mail-subject span,.mail-subject small { color: var(--color-text-secondary); }.mail-subject small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.message-stream { min-height: 340px; max-height: 430px; padding: 18px 24px; overflow: auto; background: #f6f8fb; }.date-divider { display: flex; justify-content: center; margin-bottom: 16px; }.date-divider span { padding: 3px 10px; border-radius: 99px; color: var(--color-text-placeholder); background: #e9edf3; font-size: 11px; }
.message-row { margin-bottom: 16px; display: flex; align-items: flex-start; gap: 9px; }.message-row--outbound { flex-direction: row-reverse; }.message-row--system { justify-content: center; }.message-avatar { width: 32px; height: 32px; border-radius: 9px; font-size: 12px; }.message-row--inbound .message-avatar { color: var(--color-text-body); background: #e2e8f0; }
.message-bubble { max-width: min(72%, 680px); padding: 11px 13px; border: 1px solid var(--color-border); border-radius: 4px 13px 13px 13px; background: #fff; box-shadow: 0 3px 12px rgba(29,52,82,.05); }.message-row--outbound .message-bubble { border-color: rgba(4,110,252,.2); border-radius: 13px 4px 13px 13px; background: #edf5ff; }.message-row--system .message-bubble { max-width: 78%; border-color: rgba(123,79,246,.2); border-radius: 10px; background: var(--color-ai-light); text-align: center; }
.message-bubble__meta { display: flex; align-items: center; gap: 7px; color: var(--color-text-secondary); font-size: 11px; }.message-bubble__meta strong { color: var(--color-text-body); }.message-bubble__meta time { margin-left: auto; }.message-bubble p { margin: 7px 0; line-height: 1.7; white-space: pre-wrap; }.ai-chip { display: inline-flex; align-items: center; gap: 3px; color: var(--color-ai); }.message-translation { margin-top: 8px; padding-top: 8px; color: var(--color-text-secondary); border-top: 1px dashed rgba(123,79,246,.22); font-size: 12px; line-height: 1.65; }.message-translation span { margin-right: 7px; color: var(--color-ai); }.message-state { display: block; margin-top: 7px; color: var(--color-text-placeholder); text-align: right; }
.review-composer { margin: 16px 20px 20px; padding: 16px; border: 1px solid var(--color-border); border-radius: 10px; background: #fff; transition: .2s ease; }.review-composer--focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(4,110,252,.1); }.review-composer__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }.review-composer__head h3 { margin: 2px 0 12px; }.ai-kicker { color: var(--color-ai); font-size: 10px; letter-spacing: .08em; }.composer-toolbar { margin: 12px 0; display: flex; align-items: flex-end; gap: 16px; }.composer-toolbar .field-control { width: 180px; }.composer-toolbar > span { padding-bottom: 7px; color: var(--color-text-secondary); font-size: 12px; }.composer-actions { margin-top: 10px; display: flex; align-items: center; gap: 12px; }.composer-actions > span { color: var(--color-text-secondary); font-size: 12px; }.composer-actions .arco-btn { margin-left: auto; }
@media (max-width: 1100px) { .conversation-filters { grid-template-columns: 1fr 1fr; }.conversation-layout { grid-template-columns: 290px minmax(0,1fr); }.chat-header__meta { display: none; } }
@media (max-width: 820px) { .conversation-layout { grid-template-columns: 1fr; }.thread-list { max-height: 320px; border-right: 0; border-bottom: 1px solid var(--color-divider); }.mail-subject { grid-template-columns: 1fr; }.message-bubble { max-width: 86%; }.composer-toolbar,.composer-actions { align-items: stretch; flex-direction: column; }.composer-toolbar .field-control { width: 100%; }.composer-actions .arco-btn { margin-left: 0; } }
</style>
