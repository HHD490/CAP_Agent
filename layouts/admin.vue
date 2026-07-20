<script setup lang="ts">
import {
  IconApps, IconUserGroup, IconStorage, IconRelation, IconCalendarClock, IconEmail,
  IconRobot, IconImport, IconHome, IconSettings, IconMenuFold, IconMenuUnfold, IconNotification
} from '@arco-design/web-vue/es/icon'

const route = useRoute()
const { state, refresh } = useDemoState()
const collapsed = ref(false)
const assistantOpen = ref(false)

function formatDateTime(value?: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)).replaceAll('/', '-')
}

const menu = [
  { to: '/admin', label: '获客总览', icon: IconApps },
  { to: '/admin/customers', label: '客户库', icon: IconUserGroup },
  { to: '/admin/products', label: '产品库', icon: IconStorage },
  { to: '/admin/matches', label: '智能匹配', icon: IconRelation },
  { to: '/admin/opportunities', label: '获客机会', icon: IconCalendarClock },
  { to: '/admin/outreach', label: '建联工作台', icon: IconEmail },
  { to: '/admin/tasks', label: 'Agent 任务', icon: IconRobot },
  { to: '/admin/ingestion', label: '数据接入', icon: IconImport },
  { to: '/', label: '虚拟官网', icon: IconHome }
]

function isActive(to: string) {
  return to === '/admin' ? route.path === '/admin' : route.path.startsWith(to)
}

onMounted(() => { void refresh() })
</script>

<template>
  <div :class="['admin-shell', { 'admin-shell--collapsed': collapsed }]">
    <header class="top-header">
      <div class="brand-mark"><span>百</span></div>
      <div class="brand-copy"><strong>链航智能获客中台</strong><small>ACQUISITION AGENT</small></div>
      <div class="top-header__right">
        <span class="demo-clock"><small>DEMO CLOCK</small>{{ formatDateTime(state?.currentTime) }}</span>
        <a-badge :count="state?.counts.runningTasks || 0" :dot="!(state?.counts.runningTasks)"><a-button type="text" shape="circle"><IconNotification /></a-button></a-badge>
        <span class="operator-avatar">操</span><span class="operator-name">模拟操作者</span>
      </div>
    </header>

    <aside class="side-nav">
      <nav>
        <NuxtLink v-for="item in menu" :key="item.to" :to="item.to" :class="['side-nav__item', { active: isActive(item.to) }]" :title="collapsed ? item.label : ''">
          <component :is="item.icon" /><span>{{ item.label }}</span>
        </NuxtLink>
      </nav>
      <button class="side-nav__collapse" @click="collapsed = !collapsed">
        <component :is="collapsed ? IconMenuUnfold : IconMenuFold" /><span>{{ collapsed ? '' : '收起导航' }}</span>
      </button>
    </aside>

    <main class="admin-main">
      <AgentTaskBanner />
      <slot />
    </main>

    <button class="ai-assistant-entry" aria-label="打开运小星" @click="assistantOpen = !assistantOpen">✦</button>
    <Transition name="assistant">
      <aside v-if="assistantOpen" class="ai-assistant-panel">
        <div class="ai-assistant-panel__header"><strong>✦ 运小星</strong><button @click="assistantOpen = false">×</button></div>
        <div class="ai-assistant-panel__content">
          <div class="assistant-message">
            <span>✦ 运小星</span>
            <p>对话式助手接口已预留。当前 PoC 的 Agent 能力已经嵌入客户画像、匹配、建联、回复判断和人工交接流程中。</p>
          </div>
          <div class="assistant-suggestions"><button>查看待分配机会</button><button>哪些匹配需要重算？</button></div>
        </div>
        <div class="ai-assistant-panel__input"><input disabled placeholder="PoC 暂不开放全局对话" /><button disabled>发送</button></div>
      </aside>
    </Transition>
  </div>
</template>
