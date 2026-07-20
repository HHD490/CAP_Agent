<script setup lang="ts">
import { opportunityStages } from '~/utils/opportunity'

const props = withDefaults(defineProps<{ stage: number, compact?: boolean, status?: string }>(), { compact: false, status: 'active' })
const percent = computed(() => Math.max(0, Math.min(100, ((props.stage - 1) / (opportunityStages.length - 1)) * 100)))
</script>

<template>
  <div :class="['stage-progress', { compact }]">
    <div class="stage-progress__summary">
      <span>{{ stage }}/9 · {{ opportunityStages[Math.max(0, stage - 1)] }}</span>
      <span v-if="status !== 'active'" class="muted">{{ status === 'handed_off' ? '已交接' : status === 'paused' ? '已暂停' : '已关闭' }}</span>
    </div>
    <div class="stage-progress__track">
      <span class="stage-progress__fill" :style="{ width: `${percent}%` }" />
      <span
        v-for="(_, index) in opportunityStages"
        :key="index"
        :class="['stage-progress__dot', { done: index + 1 <= stage }]"
        :style="{ left: `${(index / (opportunityStages.length - 1)) * 100}%` }"
      />
    </div>
    <div v-if="!compact" class="stage-progress__labels">
      <span v-for="(label, index) in opportunityStages" :key="label" :class="{ active: index + 1 === stage, done: index + 1 < stage }">
        {{ label }}
      </span>
    </div>
  </div>
</template>
