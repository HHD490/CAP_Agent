<script setup lang="ts">
withDefaults(defineProps<{ title?: string, status?: 'suggested' | 'confirmed' | 'running' | 'risk', evidence?: string[] }>(), {
  title: 'AI 分析', status: 'suggested', evidence: () => []
})
</script>

<template>
  <section :class="['ai-insight', `ai-insight--${status}`]">
    <div class="ai-insight__header">
      <span class="ai-spark">✦</span>
      <h3>{{ title }}</h3>
      <span class="ai-label">{{ status === 'confirmed' ? '已采纳' : status === 'running' ? 'AI 生成中' : status === 'risk' ? 'AI 风险提示' : 'AI 建议' }}</span>
    </div>
    <div class="ai-insight__body"><slot /></div>
    <div v-if="evidence.length" class="ai-evidence">
      <span>判断依据</span>
      <ul><li v-for="item in evidence" :key="item">{{ item }}</li></ul>
    </div>
    <div v-if="$slots.actions" class="ai-insight__actions"><slot name="actions" /></div>
  </section>
</template>
