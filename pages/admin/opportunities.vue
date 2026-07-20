<script setup lang="ts">
import { Message } from '@arco-design/web-vue'
import { IconRobot, IconEdit, IconEmail, IconUserAdd, IconClose, IconRefresh, IconExclamationCircle } from '@arco-design/web-vue/es/icon'
import type { EmailDraft, Opportunity } from '../../shared/types'
import { opportunityStages } from '~/utils/opportunity'

definePageMeta({ layout: 'admin' })
const route = useRoute()
const router = useRouter()
const { state, loading, runAgent, doAction } = useDemoState()
const keyword = ref('')
const stage = ref('all')
const source = ref('all')
const selectedId = ref('')
const drawerOpen = ref(false)
const activeTab = ref('overview')
const actionModal = ref<'next'|'reply'|'assign'|'close'|'send'|'contact'|''>('')
const actionLoading = ref(false)
const form = reactive({ nextAction: '', dueAt: '', owner: '', blocker: '', replyText: '我们下周有一票深圳到洛杉矶的蓝牙音箱，约 860 KG。请提供含税报价，并安排电话沟通。', closeReason: '', recipient: '', subject: '', body: '', contactId: '' })
const selectedDraft = ref<EmailDraft | null>(null)

const opportunities = computed(() => (state.value?.opportunities || []).filter(item => {
  const key = keyword.value.trim().toLowerCase()
  const hit = !key || [item.customer?.name, item.product?.name, item.owner, item.nextAction].join(' ').toLowerCase().includes(key)
  return hit && (stage.value === 'all' || item.stage === Number(stage.value)) && (source.value === 'all' || item.source === source.value)
}))
const selected = computed<Opportunity | undefined>(() => state.value?.opportunities.find(item => item.id === selectedId.value))
const selectedCustomer = computed(() => state.value?.customers.find(item => item.id === selected.value?.customerId))
const activeTasks = computed(() => state.value?.tasks.filter(task => task.targetId === selectedId.value && ['queued','running','waiting'].includes(task.status)) || [])
const latestReply = computed(() => selected.value?.events?.find(item => item.type === 'reply_received'))

function open(item: Opportunity, tab = 'overview') {
  selectedId.value = item.id; activeTab.value = tab; drawerOpen.value = true
  void router.replace({ query: { ...route.query, opportunity: item.id } })
}
function closeDrawer() { void router.replace({ query: { ...route.query, opportunity: undefined } }) }
watch(() => [route.query.opportunity, state.value?.opportunities.length] as const, ([id]) => {
  if (typeof id === 'string' && state.value?.opportunities.some(item => item.id === id)) { selectedId.value = id; drawerOpen.value = true }
}, { immediate: true })
watch(drawerOpen, value => { if (!value) closeDrawer() })

function showNext() { if (!selected.value) return; Object.assign(form, { nextAction: selected.value.nextAction, dueAt: selected.value.dueAt, owner: selected.value.owner, blocker: selected.value.blocker }); actionModal.value = 'next' }
function showReply() { if (latestReply.value) form.replyText = latestReply.value.description; actionModal.value = 'reply' }
function showAssign() { form.owner = selected.value?.owner || '负责人 A'; actionModal.value = 'assign' }
function showClose() { form.closeReason = ''; actionModal.value = 'close' }
function showContact() { form.contactId = selected.value?.contactId || ''; actionModal.value = 'contact' }
function showSend(draft: EmailDraft) { selectedDraft.value = draft; Object.assign(form, { recipient: state.value?.emailAllowlist[0] || draft.recipient, subject: draft.subject, body: draft.body }); actionModal.value = 'send' }
function openOutreach() {
  if (!selected.value) return
  void router.push({ path: '/admin/outreach', query: { opportunity: selected.value.id, focus: 'review' } })
}

async function submitAction() {
  if (!selected.value) return
  actionLoading.value = true
  try {
    if (actionModal.value === 'next') await doAction('confirm_next_action', selected.value.id, { nextAction: form.nextAction, dueAt: form.dueAt, owner: form.owner, blocker: form.blocker }, '下一步动作已确认')
    if (actionModal.value === 'reply') await doAction('simulate_reply', selected.value.id, { replyText: form.replyText }, '客户回复已模拟，Agent 正在判断意向')
    if (actionModal.value === 'assign') await doAction('assign_owner', selected.value.id, { owner: form.owner }, '负责人已分配，Agent 正在生成交接摘要')
    if (actionModal.value === 'close') await doAction('close_opportunity', selected.value.id, { reason: form.closeReason }, '机会状态已更新')
    if (actionModal.value === 'contact') await doAction('set_contact', selected.value.id, { contactId: form.contactId }, '联系人已选择，Agent 正在生成建联内容')
    if (actionModal.value === 'send' && selectedDraft.value) await doAction('send_email', selectedDraft.value.id, { recipient: form.recipient, subject: form.subject, body: form.body }, '邮件已通过白名单 SMTP 发送')
    actionModal.value = ''
  } finally { actionLoading.value = false }
}
async function translate(draft: EmailDraft) { await runAgent('outreach_drafting', 'opportunity', draft.opportunityId, { language: 'en', sourceDraftId: draft.id }) }
async function rerunCurrent() {
  if (!selected.value) return
  const mode = selected.value.stage <= 2 ? 'product_matching' : selected.value.stage <= 4 ? 'outreach_drafting' : selected.value.stage === 7 ? 'reply_qualification' : selected.value.stage >= 8 ? 'handoff_summary' : 'outreach_drafting'
  const targetType = mode === 'product_matching' ? 'customer' : 'opportunity'
  const targetId = mode === 'product_matching' ? selected.value.customerId : selected.value.id
  const input = mode === 'reply_qualification' ? { replyText: latestReply.value?.description || form.replyText } : {}
  await runAgent(mode as any, targetType, targetId, input)
}
async function reopen() { if (selected.value) await doAction('reopen_opportunity', selected.value.id, {}, '机会已重新开启') }
function sourceLabel(value: string) { return value === 'passive' ? '被动获客' : '主动获客' }
function date(value?: string) { return value ? value.slice(0, 16).replace('T', ' ') : '—' }
function overdue(item: Opportunity) { return item.dueAt && item.dueAt <= (state.value?.currentTime || '') && item.status === 'active' }
function stageOptions() { return opportunityStages.map((label, index) => ({ value: String(index+1), label: `${index+1}. ${label}` })) }
</script>

<template>
  <div>
    <header class="page-header">
      <div class="page-header__copy"><div class="breadcrumbs">智能获客 / 获客机会</div><h1>获客机会</h1><p>每条客户×产品机会独立跟踪进度、下一步动作、负责人、阻塞和完整时间线</p></div>
      <div class="page-header__actions"><a-button type="primary" @click="navigateTo('/admin/matches')">从匹配创建机会</a-button></div>
    </header>
    <main class="page-content">
      <section class="card filter-card"><div class="filter-row"><label><span class="field-label">搜索机会</span><a-input-search v-model="keyword" allow-clear placeholder="客户、产品、负责人或动作" /></label><div class="field-control"><span class="field-label">机会阶段</span><a-select v-model="stage"><a-option value="all">全部阶段</a-option><a-option v-for="item in stageOptions()" :key="item.value" :value="item.value">{{ item.label }}</a-option></a-select></div><div class="field-control"><span class="field-label">获客来源</span><a-select v-model="source"><a-option value="all">全部来源</a-option><a-option value="active">主动获客</a-option><a-option value="passive">被动获客</a-option></a-select></div><div class="filter-actions"><a-button @click="keyword='';stage='all';source='all'">重置</a-button><a-button type="primary">查询</a-button></div></div></section>
      <div class="toolbar"><span class="count-label">共 {{ opportunities.length }} 条机会</span><span class="semantic-tag info">进度属于机会，不属于客户主档</span></div>
      <section class="card">
        <a-table :data="opportunities" :loading="loading" row-key="id" :pagination="false" :scroll="{ x: 1420 }">
          <template #columns>
            <a-table-column title="客户 / 产品" fixed="left" :width="290"><template #cell="{ record }"><a-link @click="open(record)">{{ record.customer?.name }}</a-link><div class="muted truncate">{{ record.product?.name }}</div></template></a-table-column>
            <a-table-column title="来源" :width="100"><template #cell="{ record }"><span :class="['source-tag', record.source]">{{ sourceLabel(record.source) }}</span></template></a-table-column>
            <a-table-column title="进度" :width="320"><template #cell="{ record }"><StageProgress :stage="record.stage" compact :status="record.status" /></template></a-table-column>
            <a-table-column title="下一步动作" :width="280"><template #cell="{ record }"><span>{{ record.nextAction || '—' }}</span><div v-if="record.blocker" class="danger-text">阻塞：{{ record.blocker }}</div><div v-if="record.staleReview" class="text-primary">客户/产品有更新，需复核匹配</div></template></a-table-column>
            <a-table-column title="负责人" :width="110"><template #cell="{ record }">{{ record.owner || '待分配' }}</template></a-table-column>
            <a-table-column title="截止时间" :width="150"><template #cell="{ record }"><span :class="{ 'danger-text': overdue(record) }">{{ date(record.dueAt) }}</span><div v-if="overdue(record)" class="semantic-tag error">已逾期</div></template></a-table-column>
            <a-table-column title="操作" fixed="right" :width="150"><template #cell="{ record }"><a-button type="text" @click="open(record)">查看详情</a-button><a-button type="text" @click="open(record,'timeline')">时间线</a-button></template></a-table-column>
          </template>
        </a-table>
      </section>
    </main>

    <a-drawer v-model:visible="drawerOpen" :width="840" :footer="false" unmount-on-close>
      <template #title>{{ selected?.customer?.name || '机会详情' }} · {{ selected?.product?.name }}</template>
      <div v-if="selected">
        <div class="opportunity-head"><span :class="['source-tag', selected.source]">{{ sourceLabel(selected.source) }}</span><span :class="['semantic-tag', selected.status === 'active' ? 'info' : selected.status === 'handed_off' ? 'success' : 'neutral']">{{ selected.status }}</span><span v-if="overdue(selected)" class="semantic-tag error">待办已逾期</span><div class="opportunity-head__actions"><a-button @click="showNext"><template #icon><IconEdit /></template>编辑下一步</a-button><a-button :loading="activeTasks.length > 0" @click="rerunCurrent"><template #icon><IconRobot /></template>运行当前 Agent</a-button></div></div>
        <AiInsightCard v-if="activeTasks.length" title="Agent 正在运行" status="running"><p>{{ activeTasks[0]?.currentStep }} · {{ activeTasks[0]?.progress }}%</p></AiInsightCard>
        <a-alert v-if="selected.staleReview" type="warning" class="drawer-section">客户或产品资料已更新。已接受机会不会被自动覆盖，请人工复核是否需要重新匹配。</a-alert>
        <div class="progress-card card"><StageProgress :stage="selected.stage" :status="selected.status" /></div>
        <a-tabs v-model:active-key="activeTab">
          <a-tab-pane key="overview" title="机会概览">
            <section class="drawer-section"><h2>当前协作状态</h2><div class="action-card"><div class="action-card__row"><strong>下一步动作</strong><span>{{ selected.nextAction || '—' }}</span></div><div class="action-card__row"><strong>截止时间</strong><span :class="{ 'danger-text': overdue(selected) }">{{ date(selected.dueAt) }}</span></div><div class="action-card__row"><strong>负责人</strong><span>{{ selected.owner || '待分配' }}</span></div><div class="action-card__row"><strong>阻塞原因</strong><span :class="{ 'danger-text': selected.blocker }">{{ selected.blocker || '无' }}</span></div></div></section>
            <AiInsightCard v-if="selected.aiSummary" title="Agent 业务摘要" status="suggested"><p>{{ selected.aiSummary }}</p></AiInsightCard>
            <section class="drawer-section"><h2>可执行动作</h2><div class="opportunity-actions">
              <a-button v-if="!selected.contactId || selected.blocker.includes('联系人')" type="primary" @click="showContact">补充有效联系人</a-button>
              <a-button v-if="selected.stage === 5" type="primary" @click="openOutreach"><template #icon><IconEmail /></template>查看建联会话</a-button>
              <a-button v-if="selected.stage === 6" type="primary" @click="showReply"><template #icon><IconEmail /></template>模拟客户回复</a-button>
              <a-button v-if="selected.stage === 7" type="primary" @click="showReply"><template #icon><IconRobot /></template>分析客户回复</a-button>
              <a-button v-if="selected.stage === 8" type="primary" @click="showAssign"><template #icon><IconUserAdd /></template>分配负责人</a-button>
              <a-button v-if="['closed','paused'].includes(selected.status)" @click="reopen"><template #icon><IconRefresh /></template>重新开启</a-button>
              <a-button v-if="selected.status === 'active'" status="danger" @click="showClose"><template #icon><IconClose /></template>关闭 / 暂停</a-button>
            </div></section>
          </a-tab-pane>
          <a-tab-pane key="timeline" title="完整时间线">
            <div class="timeline"><article v-for="item in selected.events" :key="item.id" :class="['timeline-item', { 'timeline-item--agent': item.source === 'agent' }]"><div class="timeline-item__time">{{ date(item.createdAt) }} · {{ item.source }}</div><h3>{{ item.title }}</h3><p>{{ item.description || '—' }}</p><details v-if="Object.keys(item.data || {}).length"><summary>查看结构化证据</summary><pre>{{ JSON.stringify(item.data, null, 2) }}</pre></details></article><div v-if="!selected.events?.length" class="empty-state">暂无时间线记录</div></div>
          </a-tab-pane>
          <a-tab-pane key="emails" title="建联邮件">
            <div class="list-stack"><article v-for="draft in selected.drafts" :key="draft.id" class="card email-card"><div class="email-card__head"><span :class="['semantic-tag', draft.status === 'sent' ? 'success' : 'warning']">{{ draft.status === 'sent' ? '已发送' : '待审核' }}</span><span class="source-tag active">{{ draft.language === 'zh' ? '中文' : 'English' }}</span><span>V{{ draft.version }}</span><span class="muted">{{ date(draft.createdAt) }}</span></div><h2>{{ draft.subject }}</h2><p class="email-body">{{ draft.body }}</p><div class="email-card__actions"><a-button v-if="draft.language === 'zh'" :loading="activeTasks.some(task => task.mode === 'outreach_drafting')" @click="translate(draft)">Agent 转为英文</a-button><a-button v-if="draft.status !== 'sent'" type="primary" @click="showSend(draft)">审核并发送</a-button></div></article><div v-if="!selected.drafts?.length" class="empty-state">尚未生成建联邮件；选择有效联系人后可运行建联 Agent。</div></div>
          </a-tab-pane>
        </a-tabs>
      </div>
    </a-drawer>

    <a-modal :visible="Boolean(actionModal)" :title="actionModal === 'next' ? '确认下一步动作' : actionModal === 'reply' ? '模拟客户回复并运行 Agent' : actionModal === 'assign' ? '分配负责人' : actionModal === 'close' ? '关闭或暂停机会' : actionModal === 'send' ? '审核并发送邮件' : '选择建联联系人'" :width="actionModal === 'send' ? 640 : 500" :ok-loading="actionLoading" @cancel="actionModal = ''" @ok="submitAction">
      <div v-if="actionModal === 'next'" class="form-stack"><label><span class="field-label">下一步动作</span><a-input v-model="form.nextAction" /></label><label><span class="field-label">截止时间（ISO）</span><a-input v-model="form.dueAt" placeholder="2026-07-20T02:00:00.000Z" /></label><div class="field-control"><span class="field-label">负责人</span><a-select v-model="form.owner" allow-clear><a-option value="负责人 A">负责人 A</a-option><a-option value="负责人 B">负责人 B</a-option><a-option value="负责人 C">负责人 C</a-option></a-select></div><label><span class="field-label">阻塞原因</span><a-input v-model="form.blocker" allow-clear /></label><a-alert type="info">AI 建议经本次确认后才成为正式待办，修改内容会写入时间线。</a-alert></div>
      <div v-if="actionModal === 'reply'" class="form-stack"><a-alert type="info">这是 PoC 模拟入站邮件。回复正文将真实提交给 Agent 判断，不使用规则假装 AI 结果。</a-alert><label><span class="field-label">客户回复正文</span><a-textarea v-model="form.replyText" :auto-size="{ minRows: 5, maxRows: 10 }" /></label></div>
      <div v-if="actionModal === 'assign'" class="form-stack"><div class="field-control"><span class="field-label">负责人</span><a-select v-model="form.owner"><a-option value="负责人 A">负责人 A</a-option><a-option value="负责人 B">负责人 B</a-option><a-option value="负责人 C">负责人 C</a-option></a-select></div><a-alert type="info">分配后机会进入第 9 阶段，Agent 自动生成交接摘要。PoC 在此结束，不进入 CRM 销售管道。</a-alert></div>
      <div v-if="actionModal === 'close'" class="form-stack"><div class="field-control"><span class="field-label">关闭 / 暂停原因</span><a-select v-model="form.closeReason" placeholder="必须选择原因"><a-option value="无意向">无意向</a-option><a-option value="无回复">无回复</a-option><a-option value="产品不匹配">产品不匹配</a-option><a-option value="联系人无效">联系人无效</a-option><a-option value="重复客户">重复客户</a-option><a-option value="禁止联系">禁止联系</a-option><a-option value="需求已过期">需求已过期</a-option><a-option value="暂缓">暂缓</a-option><a-option value="其他">其他</a-option></a-select></div><a-alert type="warning"><template #title><IconExclamationCircle /> 状态变更会写入审计时间线</template>除“禁止联系”外，关闭或暂停的机会均可重新开启。</a-alert></div>
      <div v-if="actionModal === 'contact'" class="form-stack"><div class="field-control"><span class="field-label">有效联系人</span><a-select v-model="form.contactId"><a-option v-for="contact in selectedCustomer?.contacts" :key="contact.id" :value="contact.id" :disabled="contact.status !== 'contactable'">{{ contact.name || '未命名' }} · {{ contact.email }} · {{ contact.status }}</a-option></a-select></div><a-alert type="info">确认后会自动启动中文建联草稿 Agent。</a-alert></div>
      <div v-if="actionModal === 'send'" class="form-stack"><a-alert type="warning">只有 EMAIL_ALLOWLIST 中的地址可以真实发送。SMTP 未配置时系统会明确失败，并且不会伪造发送记录。</a-alert><div class="field-control"><span class="field-label">收件地址</span><a-select v-model="form.recipient" allow-create><a-option v-for="email in state?.emailAllowlist" :key="email" :value="email">{{ email }}</a-option></a-select></div><label><span class="field-label">邮件主题</span><a-input v-model="form.subject" /></label><label><span class="field-label">邮件正文</span><a-textarea v-model="form.body" :auto-size="{ minRows: 8, maxRows: 14 }" /></label></div>
    </a-modal>
  </div>
</template>

<style scoped>
.opportunity-head { margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }.opportunity-head__actions { margin-left: auto; display: flex; gap: 8px; }.progress-card { padding: 20px; margin-bottom: 14px; }.opportunity-actions { display: flex; flex-wrap: wrap; gap: 8px; }.email-card { padding: 16px; }.email-card__head { display: flex; align-items: center; gap: 8px; }.email-card h2 { margin: 12px 0 8px; }.email-body { white-space: pre-wrap; color: var(--color-text-body); }.email-card__actions { display: flex; justify-content: flex-end; gap: 8px; }.form-stack { display: grid; gap: 18px; }.timeline details { margin-top: 8px; }.timeline summary { color: var(--color-primary); cursor: pointer; font-size: 12px; }.timeline pre { max-height: 220px; overflow: auto; padding: 10px; border-radius: 8px; background: var(--color-bg-surface); color: var(--color-text-body); font-size: 11px; white-space: pre-wrap; }
@media (max-width: 767px) { .opportunity-head { align-items: flex-start; flex-wrap: wrap; }.opportunity-head__actions { margin-left: 0; width: 100%; }.opportunity-head__actions .arco-btn { flex: 1; } }
</style>
