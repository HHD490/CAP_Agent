<script setup lang="ts">
import { Message } from '@arco-design/web-vue'
import { IconRobot, IconRefresh, IconStop, IconEye } from '@arco-design/web-vue/es/icon'
import type { AgentTask } from '../../shared/types'

definePageMeta({ layout: 'admin' })
const { state, loading, runAgent, refresh } = useDemoState()
const status = ref('all')
const mode = ref('all')
const selected = ref<AgentTask | null>(null)
const drawerOpen = ref(false)
const stopping = ref(false)
const tasks = computed(() => (state.value?.tasks || []).filter(task => (status.value === 'all' || task.status === status.value) && (mode.value === 'all' || task.mode === mode.value)))
const selectedLive = computed(() => state.value?.tasks.find(task => task.id === selected.value?.id) || selected.value)
const modeLabel = (value: string) => ({ customer_profiling:'客户画像', product_matching:'产品匹配', outreach_drafting:'建联内容', reply_qualification:'回复判断', handoff_summary:'交接摘要' } as any)[value] || value
const statusType = (value: string) => value === 'completed' ? 'success' : value === 'failed' ? 'error' : value === 'stopped' ? 'neutral' : 'info'
function open(task: AgentTask) { selected.value = task; drawerOpen.value = true }
async function retry(task: AgentTask) { await runAgent(task.mode, task.targetType, task.targetId, task.mode === 'reply_qualification' ? { replyText: '请基于机会时间线中的最新回复重新判断。' } : {}) }
async function stop() { if (!selectedLive.value) return; stopping.value = true; try { await $fetch(`/api/agent/tasks/${selectedLive.value.id}/stop`, { method:'POST' }); Message.info('任务已停止'); await refresh({ quiet:true }) } catch (error:any) { Message.error(error?.data?.statusMessage || '停止任务失败') } finally { stopping.value = false } }
function date(value?: string) { return value ? value.slice(0,19).replace('T',' ') : '—' }
function errorSummary(value?: string) {
  if (!value) return ''
  try {
    const parsed = JSON.parse(value)
    const issue = Array.isArray(parsed) ? parsed[0] : parsed
    if (issue?.message) return `模型结果校验失败：${issue.message}`
  } catch {
    // 非 JSON 错误直接使用原始文本的短摘要。
  }
  return value.length > 72 ? `${value.slice(0, 72)}…` : value
}
</script>

<template>
  <div>
    <header class="page-header">
      <div class="page-header__copy"><div class="breadcrumbs">智能获客 / Agent 任务</div><h1>Agent 任务中心</h1><p>统一查看排队、思考、生成、执行、完成和失败状态；仅展示结构化证据与工具结果</p></div>
      <div class="page-header__actions"><a-button @click="refresh()"><template #icon><IconRefresh /></template>刷新任务</a-button></div>
    </header>
    <main class="page-content">
      <a-alert type="info" class="page-section"><template #title>{{ state?.model.name }} · OpenAI 标准兼容接口</template>思考模式 {{ state?.model.thinkingMode }} · 推理努力 {{ state?.model.reasoningEffort }}。系统不会展示或保存模型的隐藏思维链。</a-alert>
      <section class="card filter-card"><div class="filter-row"><div class="field-control"><span class="field-label">任务状态</span><a-select v-model="status"><a-option value="all">全部状态</a-option><a-option value="queued">排队中</a-option><a-option value="running">运行中</a-option><a-option value="completed">已完成</a-option><a-option value="failed">失败</a-option><a-option value="stopped">已停止</a-option></a-select></div><div class="field-control"><span class="field-label">任务模式</span><a-select v-model="mode"><a-option value="all">全部模式</a-option><a-option value="customer_profiling">客户画像</a-option><a-option value="product_matching">产品匹配</a-option><a-option value="outreach_drafting">建联内容</a-option><a-option value="reply_qualification">回复判断</a-option><a-option value="handoff_summary">交接摘要</a-option></a-select></div><div /><div class="filter-actions"><a-button @click="status='all';mode='all'">重置</a-button><a-button type="primary">查询</a-button></div></div></section>
      <div class="toolbar"><span class="count-label">共 {{ tasks.length }} 个任务</span><span v-if="state?.counts.runningTasks" class="semantic-tag info">{{ state.counts.runningTasks }} 个正在处理</span></div>
      <section class="card">
        <a-table :data="tasks" :loading="loading" row-key="id" :pagination="{ pageSize:20 }" :scroll="{ x: 1150 }">
          <template #columns>
            <a-table-column title="任务" :width="190"><template #cell="{ record }"><a-link @click="open(record)">{{ modeLabel(record.mode) }}</a-link><div class="muted truncate">{{ record.targetType }} · {{ record.targetId }}</div></template></a-table-column>
            <a-table-column title="状态" :width="110"><template #cell="{ record }"><span :class="['semantic-tag',statusType(record.status)]">{{ record.status }}</span></template></a-table-column>
            <a-table-column title="当前步骤 / 进度" :width="360"><template #cell="{ record }"><div class="task-progress-cell"><span>{{ record.currentStep }}</span><a-progress :percent="record.progress/100" :show-text="false" size="small" :status="record.status === 'failed' ? 'danger' : record.status === 'completed' ? 'success' : 'normal'" /></div></template></a-table-column>
            <a-table-column title="模型" :width="170"><template #cell="{ record }">{{ record.model || '—' }}</template></a-table-column>
            <a-table-column title="创建时间" :width="170"><template #cell="{ record }">{{ date(record.createdAt) }}</template></a-table-column>
            <a-table-column title="结果" :width="200"><template #cell="{ record }"><a-tooltip v-if="record.error" :content="`${errorSummary(record.error)}；点击 Trace 查看完整错误`"><span class="danger-text task-error-summary">{{ errorSummary(record.error) }}</span></a-tooltip><span v-else-if="record.status === 'completed'" class="success-text">结果已同步业务页面</span><span v-else class="muted">处理中</span></template></a-table-column>
            <a-table-column title="操作" fixed="right" :width="130"><template #cell="{ record }"><a-button type="text" @click="open(record)"><template #icon><IconEye /></template>Trace</a-button><a-button v-if="['failed','stopped','completed'].includes(record.status)" type="text" @click="retry(record)">重跑</a-button></template></a-table-column>
          </template>
        </a-table>
      </section>
    </main>

    <a-drawer v-model:visible="drawerOpen" :width="720" :footer="false" unmount-on-close>
      <template #title>{{ selectedLive ? modeLabel(selectedLive.mode) : 'Agent Trace' }}</template>
      <div v-if="selectedLive">
        <AiInsightCard :title="selectedLive.currentStep" :status="['queued','running','waiting'].includes(selectedLive.status) ? 'running' : selectedLive.status === 'failed' ? 'risk' : 'suggested'">
          <div class="task-summary"><span :class="['semantic-tag',statusType(selectedLive.status)]">{{ selectedLive.status }}</span><span>{{ selectedLive.model || '—' }}</span><span>{{ selectedLive.progress }}%</span></div>
          <a-progress :percent="selectedLive.progress/100" :status="selectedLive.status === 'failed' ? 'danger' : selectedLive.status === 'completed' ? 'success' : 'normal'" />
          <p v-if="selectedLive.error" class="danger-text task-error-detail">{{ selectedLive.error }}</p>
          <template #actions><a-button v-if="['queued','running','waiting'].includes(selectedLive.status)" status="danger" :loading="stopping" @click="stop"><template #icon><IconStop /></template>停止任务</a-button><a-button v-else @click="retry(selectedLive)"><template #icon><IconRobot /></template>重新运行</a-button></template>
        </AiInsightCard>
        <section class="drawer-section trace-section"><h2>结构化 Trace</h2><p class="muted">仅记录请求状态、业务上下文范围、模型配置、结构化结果和系统工具执行结果。</p><div class="timeline"><article v-for="step in selectedLive.steps" :key="step.id" :class="['timeline-item',{ 'timeline-item--agent':['model_request','model_result'].includes(step.phase) }]"><div class="timeline-item__time">{{ date(step.createdAt) }} · Step {{ step.sequence }} · {{ step.phase }}</div><h3>{{ step.summary }}</h3><details v-if="Object.keys(step.data || {}).length"><summary>查看结构化详情</summary><pre>{{ JSON.stringify(step.data,null,2) }}</pre></details></article></div></section>
        <section v-if="selectedLive.status === 'completed'" class="drawer-section"><h2>Agent 结果</h2><pre class="result-json">{{ JSON.stringify(selectedLive.result,null,2) }}</pre></section>
      </div>
    </a-drawer>
  </div>
</template>

<style scoped>
.task-progress-cell { min-width: 0; display: grid; gap: 5px; }.task-summary { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }.task-error-summary { max-width: 100%; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: help; }.task-error-detail { max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }.trace-section { margin-top: 24px; }.trace-section details { margin-top: 7px; }.trace-section summary { color: var(--color-primary); cursor: pointer; font-size: 12px; }.trace-section pre,.result-json { max-height: 320px; overflow: auto; padding: 12px; border-radius: 8px; color: var(--color-text-body); background: var(--color-bg-surface); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
</style>
