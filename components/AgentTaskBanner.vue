<script setup lang="ts">
const { state } = useDemoState()
const activeTasks = computed(() => state.value?.tasks.filter(task => ['queued', 'running', 'waiting'].includes(task.status)) || [])
</script>

<template>
  <Transition name="banner">
    <div v-if="activeTasks.length" class="agent-global-banner">
      <div class="agent-signal"><span /><span /><span /></div>
      <div class="agent-global-banner__content">
        <strong>Agent Running</strong>
        <span>{{ state?.model.name }} 正在处理 {{ activeTasks.length }} 个任务；完成后当前页面会自动更新。</span>
      </div>
      <div class="agent-global-banner__tasks">
        <span v-for="task in activeTasks.slice(0, 2)" :key="task.id">{{ task.currentStep }} · {{ task.progress }}%</span>
      </div>
      <NuxtLink to="/admin/tasks" class="agent-global-banner__link">查看任务</NuxtLink>
    </div>
  </Transition>
</template>
