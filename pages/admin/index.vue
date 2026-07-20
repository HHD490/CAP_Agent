<script setup lang="ts">
import { IconUserGroup, IconCalendarClock, IconExclamationCircle, IconRobot, IconRefresh, IconClockCircle, IconImport } from '@arco-design/web-vue/es/icon'
import { opportunityStages } from '~/utils/opportunity'

definePageMeta({ layout: 'admin' })
const router = useRouter()
const { state, loading, doAction, resetDemo, advanceTime } = useDemoState()
const resetting = ref(false)
const advancing = ref(false)
const syncing = ref(false)

const stageCounts = computed(() => opportunityStages.map((label, index) => ({
  label,
  stage: index + 1,
  count: state.value?.opportunities.filter(item => item.stage === index + 1).length || 0
})))
const maxStageCount = computed(() => Math.max(1, ...stageCounts.value.map(item => item.count)))
const humanItems = computed(() => (state.value?.opportunities || []).filter(item => item.status === 'active' && (item.blocker || item.stage === 5 || item.stage === 8 || (item.dueAt && item.dueAt <= (state.value?.currentTime || '')))).slice(0, 6))
const recentTasks = computed(() => state.value?.tasks.slice(0, 5) || [])

async function handleReset() {
  resetting.value = true
  try { await resetDemo() } finally { resetting.value = false }
}
async function handleAdvance() {
  advancing.value = true
  try { await advanceTime(3) } finally { advancing.value = false }
}
async function handleSync() {
  syncing.value = true
  try { await doAction('sync_wca', '', {}, '模拟 WCA 同步完成') } finally { syncing.value = false }
}
function openOpportunity(id: string) { void router.push({ path: '/admin/opportunities', query: { opportunity: id } }) }
function date(value?: string) { return value ? value.slice(0, 16).replace('T', ' ') : '—' }
function taskStatus(status: string) { return status === 'completed' ? 'success' : status === 'failed' ? 'error' : status === 'stopped' ? 'neutral' : 'info' }
</script>

<template>
  <div>
    <header class="page-header page-header--simple">
      <div class="page-header__copy"><h1>获客总览</h1><p>主动与被动获客统一进入客户、匹配和机会协作链路</p></div>
      <div class="page-header__actions">
        <a-button :loading="syncing" @click="handleSync"><template #icon><IconImport /></template>模拟 WCA 同步</a-button>
        <a-button :loading="advancing" @click="handleAdvance"><template #icon><IconClockCircle /></template>推进 3 天</a-button>
        <a-popconfirm content="确认恢复全部演示数据？当前操作记录会被重置。" @ok="handleReset">
          <a-button :loading="resetting"><template #icon><IconRefresh /></template>重置演示</a-button>
        </a-popconfirm>
      </div>
    </header>

    <main class="page-content">
      <a-alert v-if="state && !state.model.configured" type="warning" class="page-section">
        模型接口尚未配置。历史种子结果仍可查看，但新触发的 Agent 任务会明确失败，不会使用伪造回退结果。
      </a-alert>
      <a-alert v-else type="info" class="page-section">
        <template #title>{{ state?.model.name }} 已接入</template>
        OpenAI 标准兼容接口 · 思考模式 {{ state?.model.thinkingMode }} · 推理努力 {{ state?.model.reasoningEffort }} · 上下文 {{ (state?.model.contextWindowTokens || 0).toLocaleString() }} tokens
      </a-alert>

      <section class="metric-grid page-section" aria-label="运营动作统计">
        <article class="card metric-card">
          <div class="metric-card__top"><span>客户档案</span><span class="metric-card__icon"><IconUserGroup /></span></div>
          <div class="metric-card__value">{{ state?.counts.totalCustomers ?? '—' }}</div>
          <div class="metric-card__foot">WCA 模拟 {{ state?.counts.wcaCustomers || 0 }} · 官网 {{ state?.counts.websiteCustomers || 0 }}</div>
        </article>
        <article class="card metric-card metric-card--ai">
          <div class="metric-card__top"><span>运行中的 Agent</span><span class="metric-card__icon"><IconRobot /></span></div>
          <div class="metric-card__value">{{ state?.counts.runningTasks ?? '—' }}</div>
          <div class="metric-card__foot">待生成画像 {{ state?.counts.pendingProfiles || 0 }}</div>
        </article>
        <article class="card metric-card metric-card--warning">
          <div class="metric-card__top"><span>需要人工动作</span><span class="metric-card__icon"><IconExclamationCircle /></span></div>
          <div class="metric-card__value">{{ state?.counts.humanTasks ?? '—' }}</div>
          <div class="metric-card__foot">过期匹配 {{ state?.counts.staleMatches || 0 }} · 待分配 {{ state?.counts.explicitIntent || 0 }}</div>
        </article>
        <article class="card metric-card metric-card--success">
          <div class="metric-card__top"><span>进行中机会</span><span class="metric-card__icon"><IconCalendarClock /></span></div>
          <div class="metric-card__value">{{ state?.counts.activeOpportunities ?? '—' }}</div>
          <div class="metric-card__foot">仅记录已执行动作和当前进度，不代表转化成功</div>
        </article>
      </section>

      <section class="two-column page-section">
        <article class="card">
          <div class="card__header"><h2>机会阶段分布</h2><span class="muted">共 {{ state?.opportunities.length || 0 }} 条机会</span></div>
          <div class="card__body stage-distribution">
            <div v-for="item in stageCounts" :key="item.stage" class="stage-distribution__row">
              <span class="stage-distribution__name">{{ item.stage }}. {{ item.label }}</span>
              <span class="stage-distribution__bar"><i :style="{ width: `${(item.count / maxStageCount) * 100}%` }" /></span>
              <strong>{{ item.count }}</strong>
            </div>
          </div>
        </article>

        <article class="card">
          <div class="card__header"><h2>最近 Agent 任务</h2><NuxtLink class="card__header-actions text-primary" to="/admin/tasks">查看全部</NuxtLink></div>
          <div class="card__body task-mini-list">
            <div v-for="task in recentTasks" :key="task.id" class="task-mini-item">
              <span :class="['task-mini-item__dot', task.status]" />
              <div><strong>{{ task.currentStep }}</strong><small>{{ task.model || '—' }} · {{ date(task.createdAt) }}</small></div>
              <span :class="['semantic-tag', taskStatus(task.status)]">{{ task.status }}</span>
            </div>
            <div v-if="!recentTasks.length" class="empty-state">暂无 Agent 任务</div>
          </div>
        </article>
      </section>

      <section class="card page-section">
        <div class="card__header"><h2>人工待办</h2><span class="muted">AI 建议只有经人工确认后才成为正式动作</span><NuxtLink class="card__header-actions text-primary" to="/admin/opportunities">进入机会中心</NuxtLink></div>
        <a-table :data="humanItems" :pagination="false" :loading="loading" row-key="id">
          <template #columns>
            <a-table-column title="客户 / 产品" :width="290">
              <template #cell="{ record }"><a-link @click="openOpportunity(record.id)">{{ record.customer?.name }}</a-link><div class="muted">{{ record.product?.name }}</div></template>
            </a-table-column>
            <a-table-column title="当前进度" :width="300"><template #cell="{ record }"><StageProgress :stage="record.stage" compact :status="record.status" /></template></a-table-column>
            <a-table-column title="下一步动作"><template #cell="{ record }"><span>{{ record.nextAction || '—' }}</span><div v-if="record.blocker" class="danger-text">阻塞：{{ record.blocker }}</div></template></a-table-column>
            <a-table-column title="负责人" :width="110"><template #cell="{ record }">{{ record.owner || '待分配' }}</template></a-table-column>
            <a-table-column title="截止时间" :width="150"><template #cell="{ record }"><span :class="{ 'danger-text': record.dueAt && record.dueAt <= (state?.currentTime || '') }">{{ date(record.dueAt) }}</span></template></a-table-column>
            <a-table-column title="操作" :width="90"><template #cell="{ record }"><a-button type="text" @click="openOpportunity(record.id)">处理</a-button></template></a-table-column>
          </template>
        </a-table>
      </section>
    </main>
  </div>
</template>

<style scoped>
.stage-distribution { display: grid; gap: 11px; }
.stage-distribution__row { display: grid; grid-template-columns: 180px 1fr 24px; align-items: center; gap: 12px; }
.stage-distribution__name { font-size: 13px; }
.stage-distribution__bar { height: 8px; border-radius: 99px; background: var(--color-bg-surface); overflow: hidden; }
.stage-distribution__bar i { display: block; height: 100%; min-width: 3px; border-radius: inherit; background: linear-gradient(90deg, var(--color-primary-400), var(--color-ai)); }
.task-mini-list { display: grid; gap: 4px; }
.task-mini-item { min-height: 54px; display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 10px; border-bottom: 1px solid var(--color-divider); }
.task-mini-item:last-child { border-bottom: 0; }.task-mini-item strong,.task-mini-item small { display: block; }.task-mini-item small { color: var(--color-text-secondary); }
.task-mini-item__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-text-secondary); }.task-mini-item__dot.completed { background: var(--color-success); }.task-mini-item__dot.failed { background: var(--color-error); }.task-mini-item__dot.running,.task-mini-item__dot.queued { background: var(--color-ai); box-shadow: 0 0 0 4px rgba(123,79,246,.12); }
@media (max-width: 767px) { .stage-distribution__row { grid-template-columns: 120px 1fr 20px; }.page-header__actions .arco-btn:first-child { display: none; } }
</style>
