<script setup lang="ts">
import { Message } from '@arco-design/web-vue'
import { IconRobot, IconRefresh, IconCheck, IconExclamationCircle, IconEmail } from '@arco-design/web-vue/es/icon'
import type { MatchResult } from '../../shared/types'

definePageMeta({ layout: 'admin' })
const router = useRouter()
const { state, loading, runAgent, doAction, refresh } = useDemoState()
const status = ref('all')
const source = ref('all')
const selected = ref<MatchResult | null>(null)
const modalOpen = ref(false)
const contactId = ref('')
const overrideBlockers = ref(false)
const accepting = ref(false)
const batchRunning = ref(false)

const matches = computed(() => (state.value?.matches || []).filter(match => {
  const sourceValue = match.customer?.source === 'website' ? 'passive' : 'active'
  const statusHit = status.value === 'all' || (status.value === 'stale' ? match.stale : match.status === status.value)
  return statusHit && (source.value === 'all' || sourceValue === source.value)
}))
const runningCustomerIds = computed(() => new Set((state.value?.tasks || []).filter(task => task.mode === 'product_matching' && ['queued','running','waiting'].includes(task.status)).map(task => task.targetId)))

function openAccept(match: MatchResult) {
  selected.value = match
  const contacts = match.customer?.contacts || []
  contactId.value = contacts.find(contact => contact.status === 'contactable' && contact.isPrimary)?.id || contacts.find(contact => contact.status === 'contactable')?.id || ''
  overrideBlockers.value = false
  modalOpen.value = true
}
async function acceptMatch() {
  if (!selected.value) return
  accepting.value = true
  try {
    const result = await doAction('accept_match', selected.value.id, { contactId: contactId.value, overrideBlockers: overrideBlockers.value }, '匹配已接受，获客机会已创建')
    modalOpen.value = false
    if (result.opportunityId) void router.push({ path: '/admin/opportunities', query: { opportunity: result.opportunityId } })
  } finally { accepting.value = false }
}
async function rerun(match: MatchResult) { await runAgent('product_matching', 'customer', match.customerId, { triggeredBy: 'manual_match_center' }) }
function openOutreach(match: MatchResult) {
  const opportunity = state.value?.opportunities.find(item => item.customerId === match.customerId && item.productId === match.productId)
  if (!opportunity) return Message.error('未找到这条匹配对应的获客机会')
  void router.push({ path: '/admin/outreach', query: { opportunity: opportunity.id, focus: 'review' } })
}
async function batchRerun() {
  const customerIds = [...new Set((state.value?.matches || []).filter(match => match.stale).map(match => match.customerId))].slice(0, 8)
  if (!customerIds.length) return Message.info('当前没有过期匹配')
  batchRunning.value = true
  try {
    for (const id of customerIds) await $fetch('/api/agent/tasks', { method: 'POST', body: { mode: 'product_matching', targetType: 'customer', targetId: id, input: { triggeredBy: 'stale_batch' } } })
    Message.info(`已启动 ${customerIds.length} 个重新匹配任务，结果会自动更新`)
    await refresh({ quiet: true })
  } catch (error: any) { Message.error(error?.data?.statusMessage || '批量任务启动失败') }
  finally { batchRunning.value = false }
}
function confidence(value: string) { return value === 'high' ? '高' : value === 'medium' ? '中' : '低' }
</script>

<template>
  <div>
    <header class="page-header">
      <div class="page-header__copy"><div class="breadcrumbs">智能获客 / 智能匹配</div><h1>智能匹配</h1><p>确定性硬筛选 + Agent 语义判断；匹配分数仅用于排序，不代表成交概率</p></div>
      <div class="page-header__actions"><a-button :loading="batchRunning" @click="batchRerun"><template #icon><IconRefresh /></template>批量重算过期匹配</a-button></div>
    </header>
    <main class="page-content">
      <section class="card filter-card"><div class="filter-row"><div class="field-control"><span class="field-label">匹配状态</span><a-select v-model="status"><a-option value="all">全部状态</a-option><a-option value="proposed">AI 建议</a-option><a-option value="accepted">人工已接受</a-option><a-option value="stale">资料更新 / 待重算</a-option></a-select></div><div class="field-control"><span class="field-label">获客来源</span><a-select v-model="source"><a-option value="all">全部来源</a-option><a-option value="active">主动获客</a-option><a-option value="passive">被动获客</a-option></a-select></div><div /><div class="filter-actions"><a-button @click="status='all';source='all'">重置</a-button><a-button type="primary">查询</a-button></div></div></section>
      <a-alert v-if="state?.counts.staleMatches" type="warning" class="page-section">有 {{ state.counts.staleMatches }} 条匹配因客户或产品资料更新而过期。旧结果被保留，不会覆盖已接受机会；请由操作者决定是否重算。</a-alert>
      <div class="toolbar"><span class="count-label">共 {{ matches.length }} 条公司×产品匹配</span><span class="semantic-tag info">AI 建议 → 人工确认 → 创建机会</span></div>
      <section class="match-grid">
        <article v-for="match in matches" :key="match.id" :class="['card', 'match-card', { 'match-card--stale': match.stale }]">
          <div class="match-card__header">
            <div><span :class="['source-tag', match.customer?.source === 'website' ? 'passive' : 'active']">{{ match.customer?.source === 'website' ? '被动获客' : '主动获客' }}</span><span v-if="match.stale" class="semantic-tag warning">资料已更新</span><span v-if="match.status === 'accepted'" class="semantic-tag success">已接受</span></div>
            <div class="fit-score"><strong>{{ match.score }}</strong><span>匹配分</span></div>
          </div>
          <div class="match-pair"><div><small>客户</small><h2>{{ match.customer?.name }}</h2><p>{{ match.customer?.country }} · {{ match.customer?.city }}</p></div><div class="match-pair__arrow">→</div><div><small>产品</small><h2>{{ match.product?.name }}</h2><p>{{ match.product?.routes.join(' / ') }}</p></div></div>
          <div class="match-meta"><span>置信度：{{ confidence(match.confidence) }}</span><span>客户档案 V{{ match.customerVersion }}</span><span>产品 V{{ match.productVersion }}</span></div>
          <AiInsightCard title="匹配判断" :status="match.blockers.length ? 'risk' : 'suggested'" :evidence="match.evidence">
            <div v-if="match.risks.length"><strong>风险</strong><ul class="business-list"><li v-for="item in match.risks" :key="item">{{ item }}</li></ul></div>
            <div v-if="match.missing.length" class="match-list"><strong>缺失信息</strong><ul class="business-list"><li v-for="item in match.missing" :key="item">{{ item }}</li></ul></div>
            <div v-if="match.blockers.length" class="match-list danger-text"><strong>硬阻断</strong><ul class="business-list"><li v-for="item in match.blockers" :key="item">{{ item }}</li></ul></div>
          </AiInsightCard>
          <div class="match-card__actions">
            <a-button :loading="runningCustomerIds.has(match.customerId)" @click="rerun(match)"><template #icon><IconRobot /></template>{{ match.stale ? '重新匹配' : '再次运行 Agent' }}</a-button>
            <a-button v-if="match.status !== 'accepted'" type="primary" :disabled="match.stale" @click="openAccept(match)"><template #icon><IconCheck /></template>接受匹配</a-button>
            <a-button v-else @click="openOutreach(match)"><template #icon><IconEmail /></template>查看建联邮箱</a-button>
          </div>
        </article>
        <div v-if="!matches.length && !loading" class="card empty-state">未找到相关匹配，请调整筛选条件</div>
      </section>
    </main>

    <a-modal v-model:visible="modalOpen" title="确认产品匹配并创建机会" :width="560" :ok-loading="accepting" @ok="acceptMatch">
      <div v-if="selected">
        <a-alert type="info" class="modal-section">接受后会创建获客机会；选择有效联系人后，系统将自动启动 Agent 生成中文建联草稿。</a-alert>
        <dl class="detail-grid modal-section"><div class="detail-field"><dt>客户</dt><dd>{{ selected.customer?.name }}</dd></div><div class="detail-field"><dt>产品</dt><dd>{{ selected.product?.name }}</dd></div><div class="detail-field"><dt>匹配分</dt><dd>{{ selected.score }} / 100</dd></div><div class="detail-field"><dt>置信度</dt><dd>{{ confidence(selected.confidence) }}</dd></div></dl>
        <div class="field-control"><span class="field-label">建联联系人</span><a-select v-model="contactId" allow-clear placeholder="可暂不选择，机会将进入联系人待补充状态"><a-option v-for="contact in selected.customer?.contacts" :key="contact.id" :value="contact.id" :disabled="contact.status !== 'contactable'">{{ contact.name || '未命名' }} · {{ contact.email }} · {{ contact.status }}</a-option></a-select></div>
        <a-alert v-if="selected.blockers.length" type="error" class="modal-section"><template #title><IconExclamationCircle /> 存在硬阻断项</template>{{ selected.blockers.join('；') }}</a-alert>
        <a-checkbox v-if="selected.blockers.length" v-model="overrideBlockers">我已人工核查并确认仍要接受该匹配</a-checkbox>
      </div>
    </a-modal>
  </div>
</template>

<style scoped>
.match-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 16px; }.match-card { padding: 18px; }.match-card--stale { border-color: rgba(232,125,19,.35); }.match-card__header { display: flex; align-items: flex-start; justify-content: space-between; }.match-card__header > div:first-child { display: flex; gap: 6px; }.fit-score { display: flex; align-items: baseline; gap: 4px; color: var(--color-primary); }.fit-score strong { color: var(--color-primary); font-size: 28px; line-height: 1; }.fit-score span { font-size: 12px; }.match-pair { margin: 16px 0; display: grid; grid-template-columns: 1fr 28px 1fr; align-items: center; gap: 8px; }.match-pair small { color: var(--color-text-secondary); }.match-pair h2 { margin: 3px 0; }.match-pair p { margin: 0; color: var(--color-text-secondary); }.match-pair__arrow { color: var(--color-ai); font-size: 20px; text-align: center; }.match-meta { margin-bottom: 12px; display: flex; gap: 16px; color: var(--color-text-secondary); font-size: 12px; }.match-list { margin-top: 10px; }.match-card__actions { margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px; }.modal-section { margin-bottom: 18px; }
@media (max-width: 1100px) { .match-grid { grid-template-columns: 1fr; } } @media (max-width: 767px) { .match-pair { grid-template-columns: 1fr; }.match-pair__arrow { transform: rotate(90deg); }.match-meta { flex-wrap: wrap; } }
</style>
