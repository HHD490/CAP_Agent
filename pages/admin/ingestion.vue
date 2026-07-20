<script setup lang="ts">
import { Message } from '@arco-design/web-vue'
import { IconCloudDownload, IconUpload, IconEdit, IconCheckCircle, IconExclamationCircle } from '@arco-design/web-vue/es/icon'

definePageMeta({ layout: 'admin' })
const { state, doAction, refresh } = useDemoState()
const syncing = ref(false)
const importing = ref(false)
const manualOpen = ref(false)
const saving = ref(false)
const lastResult = ref<{ title: string, detail: string } | null>(null)
const manual = reactive({ name:'', country:'', city:'', website:'', email:'', contactName:'', title:'' })

async function sync() {
  syncing.value = true
  try { const result = await doAction('sync_wca', '', {}, '模拟 WCA 同步已完成'); lastResult.value = { title:'模拟同步完成', detail:`新增 ${result.created} 条，更新 ${result.updated} 条。${result.note}` } }
  finally { syncing.value = false }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importing.value = true
  try {
    const form = new FormData(); form.append('file', file)
    const result = await $fetch<any>('/api/import/customers', { method:'POST', body:form })
    Message.success(`导入完成：新增 ${result.created}，跳过 ${result.skipped}`)
    lastResult.value = { title:'文件导入完成', detail:`共读取 ${result.total} 行，新增 ${result.created} 条，因缺少名称或重复跳过 ${result.skipped} 条。` }
    await refresh({ quiet:true })
  } catch (error:any) { Message.error(error?.data?.statusMessage || '文件导入失败') }
  finally { importing.value = false; input.value = '' }
}
async function saveManual() {
  saving.value = true
  try { await doAction('manual_customer', '', manual, '客户已创建并进入统一客户库'); manualOpen.value = false; Object.assign(manual,{ name:'',country:'',city:'',website:'',email:'',contactName:'',title:'' }) }
  finally { saving.value = false }
}
</script>

<template>
  <div>
    <header class="page-header">
      <div class="page-header__copy"><div class="breadcrumbs">智能获客 / 数据接入</div><h1>数据接入</h1><p>PoC 使用模拟 WCA 同步、CSV/Excel 导入和手工录入；不接入真实会员账号或爬虫</p></div>
    </header>
    <main class="page-content">
      <a-alert type="warning" class="page-section"><template #title><IconExclamationCircle /> WCA 数据边界</template>当前“同步”完全使用虚构演示数据，不会登录、抓取或复制真实 WCA 目录。未来建设正式连接器前，需要单独确认账号授权、访问规则、频率和数据合规边界。</a-alert>
      <section class="three-column page-section">
        <article class="card ingestion-card">
          <span class="ingestion-card__icon"><IconCloudDownload /></span><h2>模拟 WCA 同步</h2><p>演示海外货运代理客户的批次接入与更新。现有 {{ state?.counts.wcaCustomers || 0 }} 条虚构 WCA 风格档案。</p><ul><li>会员编号精确去重</li><li>原始来源与标准化事实分层</li><li>新客户待 Agent 画像</li></ul><a-button type="primary" long :loading="syncing" @click="sync">运行模拟同步</a-button>
        </article>
        <article class="card ingestion-card">
          <span class="ingestion-card__icon ingestion-card__icon--purple"><IconUpload /></span><h2>CSV / Excel 导入</h2><p>支持首个工作表，最多 200 行、5 MB。表头可使用 company、country、city、website、email 或对应中文字段。</p><div class="upload-zone"><input type="file" accept=".csv,.xlsx,.xls" :disabled="importing" @change="importFile" /><IconUpload /><strong>{{ importing ? '正在解析并导入…' : '点击选择 CSV 或 Excel 文件' }}</strong><span>支持 .csv / .xlsx / .xls，最大 5 MB</span></div>
        </article>
        <article class="card ingestion-card">
          <span class="ingestion-card__icon ingestion-card__icon--green"><IconEdit /></span><h2>手工录入</h2><p>用于少量线索补录。创建后进入统一客户库，初始状态为待画像，可继续运行 Agent 产品匹配。</p><ul><li>公司名称必填</li><li>联系人可后补</li><li>完整保留创建来源</li></ul><a-button type="primary" long @click="manualOpen=true">新建客户档案</a-button>
        </article>
      </section>
      <section v-if="lastResult" class="card result-card"><IconCheckCircle /><div><h2>{{ lastResult.title }}</h2><p>{{ lastResult.detail }}</p></div><a-button @click="navigateTo('/admin/customers')">查看客户库</a-button></section>
      <section class="card page-section">
        <div class="card__header"><h2>去重与合并规则</h2><span class="muted">PoC 自动精确匹配，模糊关系只提示不自动合并</span></div>
        <div class="card__body dedupe-grid"><div><span class="semantic-tag success">可自动关联</span><h3>精确 WCA 模拟会员编号</h3><p>来源编号完全一致时更新原档案。</p></div><div><span class="semantic-tag success">可自动关联</span><h3>精确联系人邮箱</h3><p>标准化邮箱完全一致时关联现有客户。</p></div><div><span class="semantic-tag success">可自动关联</span><h3>域名 + 国家</h3><p>公司域名与国家同时完全一致时可关联。</p></div><div><span class="semantic-tag warning">人工确认</span><h3>名称或集团关系相似</h3><p>只形成疑似重复提示，由人工决定合并。</p></div></div>
      </section>
    </main>

    <a-modal v-model:visible="manualOpen" title="手工新建客户档案" :width="560" :ok-loading="saving" @ok="saveManual">
      <div class="manual-form"><label><span class="field-label">* 客户公司名称</span><a-input v-model="manual.name" placeholder="请输入公司名称" /></label><label><span class="field-label">国家</span><a-input v-model="manual.country" /></label><label><span class="field-label">城市</span><a-input v-model="manual.city" /></label><label><span class="field-label">网站</span><a-input v-model="manual.website" placeholder="https://example.com" /></label><label><span class="field-label">联系人姓名</span><a-input v-model="manual.contactName" /></label><label><span class="field-label">职位</span><a-input v-model="manual.title" /></label><label class="span-2"><span class="field-label">联系人邮箱</span><a-input v-model="manual.email" /></label></div>
    </a-modal>
  </div>
</template>

<style scoped>
.ingestion-card { padding: 22px; min-height: 360px; display: flex; flex-direction: column; }.ingestion-card__icon { width: 44px; height: 44px; display: grid; place-items:center; border-radius: 12px; color: var(--color-primary); background: var(--color-primary-50); font-size:22px; }.ingestion-card__icon--purple { color:var(--color-ai); background:var(--color-ai-light); }.ingestion-card__icon--green { color:var(--color-success); background:var(--color-success-bg); }.ingestion-card h2 { margin:16px 0 6px; }.ingestion-card p { color:var(--color-text-secondary); }.ingestion-card ul { margin:4px 0 18px; padding-left:20px; }.ingestion-card .arco-btn { margin-top:auto; }.upload-zone { position:relative; flex:1; min-height:170px; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:8px; border:1px dashed var(--color-border); border-radius:8px; transition:background .1s,border-color .1s; }.upload-zone:hover { border-color:var(--color-primary); background:var(--color-primary-50); }.upload-zone input { position:absolute; inset:0; width:100%; opacity:0; cursor:pointer; }.upload-zone svg { font-size:26px; color:var(--color-ai); }.upload-zone span { color:var(--color-text-secondary); font-size:12px; }.result-card { margin-bottom:24px; padding:18px; display:flex; align-items:center; gap:14px; border-color:rgba(24,160,88,.24); background:var(--color-success-bg); }.result-card > svg { color:var(--color-success); font-size:26px; }.result-card h2,.result-card p { margin:0; }.result-card .arco-btn { margin-left:auto; }.dedupe-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }.dedupe-grid > div { padding:14px; border-radius:8px; background:var(--color-bg-surface); }.dedupe-grid h3 { margin:10px 0 3px; }.dedupe-grid p { margin:0; color:var(--color-text-secondary); }.manual-form { display:grid; grid-template-columns:1fr 1fr; gap:20px 24px; }.span-2 { grid-column:span 2; }
@media(max-width:1000px){.dedupe-grid{grid-template-columns:repeat(2,1fr)}} @media(max-width:767px){.manual-form,.dedupe-grid{grid-template-columns:1fr}.span-2{grid-column:auto}}
</style>
