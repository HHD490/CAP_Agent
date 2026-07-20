<script setup lang="ts">
import { IconEdit, IconRefresh, IconStorage } from '@arco-design/web-vue/es/icon'
import type { Product } from '../../shared/types'

definePageMeta({ layout: 'admin' })
const { state, loading, doAction } = useDemoState()
const keyword = ref('')
const category = ref('all')
const selected = ref<Product | null>(null)
const drawerOpen = ref(false)
const updating = ref(false)
const products = computed(() => (state.value?.products || []).filter(product => {
  const key = keyword.value.trim().toLowerCase()
  return (!key || [product.code, product.name, product.routes.join(' '), product.capabilities.join(' ')].join(' ').toLowerCase().includes(key)) && (category.value === 'all' || product.category === category.value)
}))
const selectedLive = computed(() => state.value?.products.find(product => product.id === selected.value?.id) || selected.value)
const staleCount = computed(() => state.value?.matches.filter(match => match.productId === selectedLive.value?.id && match.stale).length || 0)
function open(product: Product) { selected.value = product; drawerOpen.value = true }
async function simulateUpdate() {
  if (!selectedLive.value) return
  updating.value = true
  try {
    await doAction('update_product', selectedLive.value.id, { marketing: { demoUpdate: '新增获客卖点：旺季舱位协同与异常主动反馈', updatedAt: state.value?.currentTime } }, '产品获客资料已更新，相关匹配已提示过期')
  } finally { updating.value = false }
}
function quoteTag(product: Product) { return product.quoteReady ? '可展示参考价' : '需人工询价' }
</script>

<template>
  <div>
    <header class="page-header">
      <div class="page-header__copy"><div class="breadcrumbs">智能获客 / 产品库</div><h1>产品库</h1><p>PMS 核心快照只读，获客营销资料独立维护；本 PoC 共 12 个已发布产品</p></div>
      <div class="page-header__actions"><a-button disabled>等待 PMS 正式同步</a-button></div>
    </header>
    <main class="page-content">
      <a-alert type="info" class="page-section">BY001–BY004 来自 PMS 原型资料；SIM005–SIM012 是明确标注的 PoC 模拟产品。全部暂按“已发布”处理。</a-alert>
      <section class="card filter-card"><div class="filter-row"><label><span class="field-label">搜索产品</span><a-input-search v-model="keyword" allow-clear placeholder="产品编码、名称、线路、能力" /></label><div class="field-control"><span class="field-label">运输类型</span><a-select v-model="category"><a-option value="all">全部类型</a-option><a-option value="空运">空运</a-option><a-option value="海运">海运</a-option><a-option value="陆运">陆运</a-option><a-option value="快递">快递</a-option><a-option value="联运">联运</a-option></a-select></div><div /><div class="filter-actions"><a-button @click="keyword='';category='all'">重置</a-button><a-button type="primary">查询</a-button></div></div></section>
      <div class="toolbar"><span class="count-label">共 {{ products.length }} 个已发布产品</span><span class="semantic-tag warning">产品更新不会自动扫描全部客户</span></div>
      <section class="product-grid">
        <article v-for="product in products" :key="product.id" class="card card--interactive product-card" @click="open(product)">
          <div class="product-card__top"><span class="product-code">{{ product.code }}</span><span v-if="product.simulated" class="source-tag passive">PoC 模拟</span><span v-else class="source-tag wca_simulated">PMS 快照</span></div>
          <h2>{{ product.name }}</h2>
          <div class="product-card__route">{{ product.routes.join(' / ') }}</div>
          <div class="product-card__tags"><span v-for="capability in product.capabilities.slice(0, 3)" :key="capability">{{ capability }}</span></div>
          <div class="product-card__footer"><span>{{ product.transitTime }}</span><span :class="['semantic-tag', product.quoteReady ? 'success' : 'warning']">{{ quoteTag(product) }}</span></div>
          <div class="product-card__version">Product V{{ product.productVersion }}</div>
        </article>
      </section>
    </main>

    <a-drawer v-model:visible="drawerOpen" :width="680" :footer="false" unmount-on-close>
      <template #title>{{ selectedLive?.code }} · {{ selectedLive?.name }}</template>
      <div v-if="selectedLive">
        <div class="product-detail-head"><span v-if="selectedLive.simulated" class="source-tag passive">PoC 模拟产品</span><span v-else class="source-tag wca_simulated">PMS 原型产品</span><span class="semantic-tag success">已发布</span><span class="semantic-tag neutral">V{{ selectedLive.productVersion }}</span><a-button class="product-detail-head__action" :loading="updating" @click="simulateUpdate"><template #icon><IconEdit /></template>模拟更新获客资料</a-button></div>
        <a-alert v-if="staleCount" type="warning" class="drawer-section">该产品已有 {{ staleCount }} 条匹配结果过期。旧结果被保留，操作者可在智能匹配页决定是否重算。</a-alert>
        <section class="drawer-section"><h2><IconStorage /> PMS 核心快照（只读）</h2><dl class="detail-grid"><div class="detail-field"><dt>产品编码</dt><dd>{{ selectedLive.code }}</dd></div><div class="detail-field"><dt>产品名称</dt><dd>{{ selectedLive.name }}</dd></div><div class="detail-field"><dt>产品分类</dt><dd>{{ selectedLive.category }} · {{ selectedLive.transportMode }}</dd></div><div class="detail-field"><dt>适用线路</dt><dd>{{ selectedLive.routes.join('、') }}</dd></div><div class="detail-field"><dt>适配货物</dt><dd>{{ selectedLive.cargoTypes.join('、') }}</dd></div><div class="detail-field"><dt>时效</dt><dd>{{ selectedLive.transitTime }}</dd></div><div class="detail-field"><dt>参考报价</dt><dd>{{ selectedLive.referencePrice }}</dd></div><div class="detail-field"><dt>报价状态</dt><dd>{{ quoteTag(selectedLive) }}</dd></div></dl></section>
        <section class="drawer-section"><h2>获客营销资料（可维护）</h2><div class="action-card"><div class="detail-field"><dt>获客标题</dt><dd>{{ selectedLive.marketing.headline || '—' }}</dd></div><div class="detail-field marketing-field"><dt>核心卖点</dt><dd>{{ (selectedLive.marketing.sellingPoints || []).join('、') || '—' }}</dd></div><div class="detail-field marketing-field"><dt>理想客户</dt><dd>{{ selectedLive.marketing.idealCustomer || '—' }}</dd></div><div v-if="selectedLive.marketing.demoUpdate" class="detail-field marketing-field"><dt>本次更新</dt><dd>{{ selectedLive.marketing.demoUpdate }}</dd></div></div></section>
        <AiInsightCard title="匹配使用说明" status="suggested"><p>Agent 使用 PMS 核心能力和获客营销资料进行语义匹配。分数只用于排序，硬阻断、风险和缺失信息会单独展示。</p><template #actions><a-button @click="navigateTo('/admin/matches')"><template #icon><IconRefresh /></template>前往智能匹配</a-button></template></AiInsightCard>
      </div>
    </a-drawer>
  </div>
</template>

<style scoped>
.product-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }.product-card { position: relative; padding: 18px; min-height: 228px; }.product-card__top,.product-card__footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; }.product-code { color: var(--color-primary); font-size: 13px; }.product-card h2 { margin: 14px 0 6px; }.product-card__route { color: var(--color-text-secondary); }.product-card__tags { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 6px; }.product-card__tags span { padding: 3px 8px; border-radius: 8px; color: #5b4fcf; background: #edeaff; font-size: 12px; }.product-card__footer { position: absolute; left: 18px; right: 18px; bottom: 17px; padding-top: 14px; border-top: 1px solid var(--color-divider); }.product-card__version { position: absolute; right: 18px; top: 52px; color: var(--color-text-secondary); font-size: 11px; }.product-detail-head { margin-bottom: 20px; display: flex; align-items: center; gap: 8px; }.product-detail-head__action { margin-left: auto; }.marketing-field { margin-top: 14px; }
@media (max-width: 1279px) { .product-grid { grid-template-columns: repeat(2, 1fr); } } @media (max-width: 767px) { .product-grid { grid-template-columns: 1fr; }.product-detail-head { flex-wrap: wrap; }.product-detail-head__action { margin-left: 0; } }
</style>
