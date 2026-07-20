<script setup lang="ts">
import { IconRobot, IconRefresh, IconEdit, IconStar, IconHistory } from '@arco-design/web-vue/es/icon'
import type { Customer, Inquiry } from '../../shared/types'

definePageMeta({ layout: 'admin' })
const { state, loading, runAgent, doAction } = useDemoState()
const keyword = ref('')
const source = ref('all')
const profileStatus = ref('all')
const selected = ref<Customer | null>(null)
const drawerOpen = ref(false)
const activeTab = ref('profile')
const runningAction = ref('')

const customers = computed(() => (state.value?.customers || []).filter(customer => {
  const key = keyword.value.trim().toLowerCase()
  const hit = !key || [customer.name, customer.country, customer.city, customer.domain, customer.contacts.map(item => item.email).join(' ')].join(' ').toLowerCase().includes(key)
  return hit && (source.value === 'all' || customer.source === source.value) && (profileStatus.value === 'all' || customer.aiProfileStatus === profileStatus.value)
}))
const selectedLive = computed(() => state.value?.customers.find(customer => customer.id === selected.value?.id) || selected.value)
const selectedEvents = computed(() => (state.value?.opportunities || []).filter(item => item.customerId === selectedLive.value?.id).flatMap(item => item.events || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
const selectedInquiries = computed(() => (state.value?.inquiries || [])
  .filter(item => item.customerId === selectedLive.value?.id)
  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
const hasRunning = (customerId: string, mode?: string) => state.value?.tasks.some(task => task.targetId === customerId && (!mode || task.mode === mode) && ['queued', 'running', 'waiting'].includes(task.status))

function openCustomer(customer: Customer, tab = 'profile') { selected.value = customer; activeTab.value = tab; drawerOpen.value = true }
async function run(mode: 'customer_profiling' | 'product_matching') {
  if (!selectedLive.value) return
  runningAction.value = mode
  try { await runAgent(mode, 'customer', selectedLive.value.id, mode === 'customer_profiling' ? { autoMatch: true } : {}) }
  finally { runningAction.value = '' }
}
async function updateCustomer() {
  if (!selectedLive.value) return
  runningAction.value = 'update'
  try { await doAction('update_customer', selectedLive.value.id, { facts: { demoUpdate: '新增：客户关注稳定舱位与目的港协作', updatedAt: state.value?.currentTime } }, '客户资料已更新，相关匹配已标记过期') }
  finally { runningAction.value = '' }
}
async function confirmProfile() {
  if (!selectedLive.value) return
  await doAction('accept_profile', selectedLive.value.id, {}, 'AI 画像已确认并进入标准化事实层')
}
async function setFocus(opportunityId: string) { await doAction('set_focus', opportunityId, {}, '焦点机会已更新') }
function sourceLabel(value: string) { return value === 'wca_simulated' ? 'WCA 模拟' : value === 'website' ? '官网入档' : value === 'import' ? '文件导入' : '手工录入' }
function typeLabel(value: string) { return ({ freight_forwarder_partner: '海外货代伙伴', ecommerce_seller: '跨境电商卖家', exporter: '出口企业', trading_company: '贸易公司', direct_shipper: '直接货主', unknown: '待识别' } as any)[value] || value }
function date(value?: string) { return value ? value.slice(0, 16).replace('T', ' ') : '—' }
function productName(productId: string) { return state.value?.products.find(item => item.id === productId)?.name || '—' }
function listValue(value: unknown) { return Array.isArray(value) ? value.join('、') : '—' }
function inquiryCount(customerId: string) { return (state.value?.inquiries || []).filter(item => item.customerId === customerId).length }
function inquiryStatusLabel(value: string) { return ({ draft: '填写中', identified: '已入档', quoted: '已出方案', converted: '已形成机会' } as Record<string, string>)[value] || value }
function measure(value: number, maximumFractionDigits = 3) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits }).format(value) }
function detailValue(inquiry: Inquiry, key: string) { return String(inquiry.details?.[key] || '—') }
function inquiryDelta(current: Inquiry, previous?: Inquiry) {
  if (!previous) return ''
  const changes: string[] = []
  if (current.origin !== previous.origin || current.destination !== previous.destination) changes.push(`线路由 ${previous.origin}→${previous.destination} 改为 ${current.origin}→${current.destination}`)
  if (current.cargoName !== previous.cargoName) changes.push(`货物由“${previous.cargoName}”改为“${current.cargoName}”`)
  const weightDelta = current.weightKg - previous.weightKg
  if (weightDelta) changes.push(`重量 ${weightDelta > 0 ? '+' : ''}${measure(weightDelta)} KG`)
  const volumeDelta = current.volumeCbm - previous.volumeCbm
  if (volumeDelta) changes.push(`体积 ${volumeDelta > 0 ? '+' : ''}${measure(volumeDelta, 4)} CBM`)
  if (current.preference !== previous.preference) changes.push(`运输偏好改为“${current.preference}”`)
  return changes.join('；')
}
</script>

<template>
  <div>
    <header class="page-header">
      <div class="page-header__copy"><div class="breadcrumbs">智能获客 / 客户库</div><h1>客户库</h1><p>统一管理主动导入与官网入档客户，区分原始数据、标准事实和 AI 推断</p></div>
      <div class="page-header__actions"><a-button type="primary" @click="navigateTo('/admin/ingestion')">新增 / 导入客户</a-button></div>
    </header>
    <main class="page-content">
      <section class="card filter-card">
        <div class="filter-row">
          <label><span class="field-label">搜索客户</span><a-input-search v-model="keyword" allow-clear placeholder="公司、国家、域名或邮箱" /></label>
          <div class="field-control"><span class="field-label">客户来源</span><a-select v-model="source"><a-option value="all">全部来源</a-option><a-option value="wca_simulated">WCA 模拟</a-option><a-option value="website">官网入档</a-option><a-option value="import">文件导入</a-option><a-option value="manual">手工录入</a-option></a-select></div>
          <div class="field-control"><span class="field-label">画像状态</span><a-select v-model="profileStatus"><a-option value="all">全部状态</a-option><a-option value="pending">待生成</a-option><a-option value="suggested">AI 建议</a-option><a-option value="confirmed">人工已确认</a-option></a-select></div>
          <div class="filter-actions"><a-button @click="keyword='';source='all';profileStatus='all'">重置</a-button><a-button type="primary">查询</a-button></div>
        </div>
      </section>
      <div class="toolbar"><span class="count-label">共 {{ customers.length }} 条客户档案</span><span class="semantic-tag info">官网客户自动并入同一客户库</span></div>
      <section class="card">
        <a-table :data="customers" :loading="loading" row-key="id" :pagination="{ pageSize: 20, showTotal: true }" :scroll="{ x: 1320 }">
          <template #columns>
            <a-table-column title="客户公司" fixed="left" :width="250">
              <template #cell="{ record }"><a-link @click="openCustomer(record)">{{ record.name }}</a-link><div class="muted truncate">{{ record.domain || record.sourceRef || '—' }}</div></template>
            </a-table-column>
            <a-table-column title="来源" :width="110"><template #cell="{ record }"><span :class="['source-tag', record.source]">{{ sourceLabel(record.source) }}</span></template></a-table-column>
            <a-table-column title="国家 / 城市" :width="150"><template #cell="{ record }">{{ record.country || '—' }} · {{ record.city || '—' }}</template></a-table-column>
            <a-table-column title="客户类型" :width="150"><template #cell="{ record }">{{ typeLabel(record.customerType) }}</template></a-table-column>
            <a-table-column title="AI 画像" :width="120"><template #cell="{ record }"><span :class="['semantic-tag', record.aiProfileStatus === 'confirmed' ? 'success' : record.aiProfileStatus === 'pending' ? 'warning' : 'info']">{{ record.aiProfileStatus === 'confirmed' ? '人工已确认' : record.aiProfileStatus === 'pending' ? '待生成' : 'AI 建议' }}</span></template></a-table-column>
            <a-table-column title="询价记录" :width="110"><template #cell="{ record }"><a-button v-if="inquiryCount(record.id)" type="text" size="small" @click="openCustomer(record, 'inquiries')">{{ inquiryCount(record.id) }} 次</a-button><span v-else>—</span></template></a-table-column>
            <a-table-column title="焦点机会进度" :width="310"><template #cell="{ record }"><StageProgress v-if="record.focusOpportunity" :stage="record.focusOpportunity.stage" compact :status="record.focusOpportunity.status" /><span v-else>—</span></template></a-table-column>
            <a-table-column title="最近活动" :width="150"><template #cell="{ record }">{{ date(record.lastActivityAt) }}</template></a-table-column>
            <a-table-column title="操作" fixed="right" :width="180"><template #cell="{ record }"><a-button type="text" @click="openCustomer(record)">详情</a-button><a-button type="text" :loading="hasRunning(record.id)" @click="selected=record;run(record.aiProfileStatus === 'pending' ? 'customer_profiling' : 'product_matching')">{{ record.aiProfileStatus === 'pending' ? '生成画像' : '重新匹配' }}</a-button></template></a-table-column>
          </template>
        </a-table>
      </section>
    </main>

    <a-drawer v-model:visible="drawerOpen" :width="760" :footer="false" unmount-on-close>
      <template #title>{{ selectedLive?.name || '客户详情' }}</template>
      <div v-if="selectedLive" class="customer-drawer">
        <div class="customer-summary">
          <div><span :class="['source-tag', selectedLive.source]">{{ sourceLabel(selectedLive.source) }}</span><span class="semantic-tag neutral">档案 V{{ selectedLive.profileVersion }}</span></div>
          <div class="customer-summary__actions">
            <a-button :loading="runningAction === 'update'" @click="updateCustomer"><template #icon><IconEdit /></template>模拟更新资料</a-button>
            <a-button :loading="runningAction === 'product_matching' || hasRunning(selectedLive.id, 'product_matching')" @click="run('product_matching')"><template #icon><IconRefresh /></template>重新匹配</a-button>
            <a-button type="primary" :loading="runningAction === 'customer_profiling' || hasRunning(selectedLive.id, 'customer_profiling')" @click="run('customer_profiling')"><template #icon><IconRobot /></template>运行画像 Agent</a-button>
          </div>
        </div>
        <a-tabs v-model:active-key="activeTab">
          <a-tab-pane key="profile" title="客户档案">
            <section class="drawer-section"><h2>标准化事实</h2><dl class="detail-grid"><div class="detail-field"><dt>客户来源</dt><dd>{{ sourceLabel(selectedLive.source) }}</dd></div><div class="detail-field"><dt>来源编号</dt><dd>{{ selectedLive.sourceRef || '—' }}</dd></div><div class="detail-field"><dt>国家 / 城市</dt><dd>{{ selectedLive.country || '—' }} / {{ selectedLive.city || '—' }}</dd></div><div class="detail-field"><dt>客户类型</dt><dd>{{ typeLabel(selectedLive.customerType) }}</dd></div><div class="detail-field"><dt>域名</dt><dd>{{ selectedLive.domain || '—' }}</dd></div><div class="detail-field"><dt>服务能力</dt><dd>{{ listValue(selectedLive.facts.serviceCapabilities) }}</dd></div></dl></section>
            <AiInsightCard v-if="selectedLive.aiProfileStatus !== 'pending'" title="客户画像" :status="selectedLive.aiProfileStatus === 'confirmed' ? 'confirmed' : 'suggested'" :evidence="selectedLive.aiProfile.evidence || []">
              <p>{{ selectedLive.aiProfile.summary || '—' }}</p>
              <div class="detail-grid"><div class="detail-field"><dt>可能需求</dt><dd>{{ (selectedLive.aiProfile.likelyNeeds || []).join('、') || '—' }}</dd></div><div class="detail-field"><dt>目标线路</dt><dd>{{ (selectedLive.aiProfile.targetLanes || []).join('、') || '—' }}</dd></div><div class="detail-field"><dt>置信度</dt><dd>{{ selectedLive.aiProfile.confidence || '—' }}</dd></div></div>
              <template #actions><a-button v-if="selectedLive.aiProfileStatus !== 'confirmed'" type="primary" @click="confirmProfile">确认画像</a-button><a-button @click="run('customer_profiling')">重新生成</a-button></template>
            </AiInsightCard>
            <AiInsightCard v-else title="客户画像" status="running"><p>{{ hasRunning(selectedLive.id, 'customer_profiling') ? 'Agent 正在整理原始事实、生成客户画像。' : '尚未生成画像，可运行客户画像 Agent。' }}</p></AiInsightCard>
            <section class="drawer-section contact-section"><h2>联系人</h2><div class="list-stack"><div v-for="contact in selectedLive.contacts" :key="contact.id" class="action-card"><div class="action-card__row"><strong>{{ contact.name || '未命名联系人' }}</strong><span>{{ contact.title || '—' }}</span><span class="semantic-tag success">{{ contact.status }}</span></div><div class="muted">{{ contact.email || '—' }}</div></div></div></section>
          </a-tab-pane>
          <a-tab-pane key="opportunities" title="获客机会">
            <div class="list-stack">
              <article v-for="opportunity in selectedLive.opportunities" :key="opportunity.id" class="card opportunity-mini-card">
                <div class="opportunity-mini-card__header"><strong>{{ productName(opportunity.productId) }}</strong><span :class="['source-tag', opportunity.source]">{{ opportunity.source === 'passive' ? '被动获客' : '主动获客' }}</span><a-button type="text" size="small" @click="setFocus(opportunity.id)"><template #icon><IconStar /></template>{{ opportunity.focus ? '焦点机会' : '设为焦点' }}</a-button></div>
                <StageProgress :stage="opportunity.stage" :status="opportunity.status" />
                <div class="opportunity-meta"><span>下一步：{{ opportunity.nextAction || '—' }}</span><span>负责人：{{ opportunity.owner || '待分配' }}</span></div>
              </article>
              <div v-if="!selectedLive.opportunities.length" class="empty-state">该客户尚无获客机会</div>
            </div>
          </a-tab-pane>
          <a-tab-pane key="timeline" title="操作时间线">
            <div class="timeline">
              <article v-for="item in selectedEvents" :key="item.id" :class="['timeline-item', { 'timeline-item--agent': item.source === 'agent' }]">
                <div class="timeline-item__time">{{ date(item.createdAt) }} · {{ item.source }}</div><h3>{{ item.title }}</h3><p>{{ item.description || '—' }}</p>
              </article>
              <div v-if="!selectedEvents.length" class="empty-state"><IconHistory /> 暂无操作记录</div>
            </div>
          </a-tab-pane>
          <a-tab-pane key="inquiries" :title="`询价记录 (${selectedInquiries.length})`">
            <article v-for="(inquiry, index) in selectedInquiries" :key="inquiry.id" class="card inquiry-card">
              <div class="inquiry-card__head"><div><span class="semantic-tag neutral">第 {{ selectedInquiries.length - index }} 次询价</span><strong>{{ inquiry.origin }} → {{ inquiry.destination }}</strong></div><div><span :class="['semantic-tag', inquiry.status === 'converted' ? 'success' : 'info']">{{ inquiryStatusLabel(inquiry.status) }}</span><span class="muted">{{ date(inquiry.updatedAt) }}</span></div></div>
              <div v-if="index === 0 && inquiryDelta(inquiry, selectedInquiries[index + 1])" class="inquiry-change"><strong>与上次相比</strong><span>{{ inquiryDelta(inquiry, selectedInquiries[index + 1]) }}</span></div>
              <dl class="detail-grid"><div class="detail-field"><dt>货物</dt><dd>{{ inquiry.cargoName }}</dd></div><div class="detail-field"><dt>重量</dt><dd>{{ measure(inquiry.weightKg) }} KG</dd></div><div class="detail-field"><dt>体积</dt><dd>{{ measure(inquiry.volumeCbm, 4) }} CBM</dd></div><div class="detail-field"><dt>偏好</dt><dd>{{ inquiry.preference }}</dd></div><div class="detail-field"><dt>计划出货</dt><dd>{{ detailValue(inquiry, 'shipmentDate') }}</dd></div><div class="detail-field"><dt>月均货量</dt><dd>{{ detailValue(inquiry, 'monthlyVolume') }}</dd></div><div class="detail-field"><dt>贸易条款</dt><dd>{{ detailValue(inquiry, 'tradeTerm') }}</dd></div></dl>
              <h3>当次推荐结果</h3><ul class="business-list"><li v-for="rec in inquiry.recommendations" :key="String(rec.productId)">{{ productName(String(rec.productId)) }} · 参考匹配 {{ rec.score || rec.fit || '—' }}</li></ul>
            </article>
            <div v-if="!selectedInquiries.length" class="empty-state">该客户没有官网询价记录</div>
          </a-tab-pane>
        </a-tabs>
      </div>
    </a-drawer>
  </div>
</template>

<style scoped>
.customer-summary { margin-bottom: 8px; display: flex; align-items: center; gap: 12px; }.customer-summary > div:first-child { display: flex; gap: 8px; }.customer-summary__actions { margin-left: auto; display: flex; gap: 8px; }
.contact-section { margin-top: 24px; }.opportunity-mini-card,.inquiry-card { padding: 16px; }.opportunity-mini-card__header,.inquiry-card__head { margin-bottom: 14px; display: flex; align-items: center; gap: 10px; }.opportunity-mini-card__header .arco-btn { margin-left: auto; }.opportunity-meta { margin-top: 16px; display: flex; justify-content: space-between; color: var(--color-text-secondary); font-size: 13px; }.inquiry-card h3 { margin: 18px 0 6px; }
.inquiry-card__head { justify-content: space-between; }.inquiry-card__head > div { display: flex; align-items: center; gap: 10px; }.inquiry-change { display: flex; gap: 10px; margin: 0 0 14px; padding: 10px 12px; border-radius: 8px; background: var(--color-fill-1); color: var(--color-text-secondary); font-size: 13px; line-height: 1.6; }.inquiry-change strong { flex: 0 0 auto; color: var(--color-text-1); }
@media (max-width: 767px) { .customer-summary { align-items: flex-start; flex-direction: column; }.customer-summary__actions { margin-left: 0; flex-wrap: wrap; }.opportunity-meta { flex-direction: column; gap: 4px; } }
</style>
