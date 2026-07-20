import { Message, Notification } from '@arco-design/web-vue'
import type { AgentMode, DemoState } from '../shared/types'

export function useDemoState() {
  const state = useState<DemoState | null>('demo-state', () => null)
  const loading = useState('demo-state-loading', () => false)
  const initialized = useState('demo-state-initialized', () => false)
  const pollStarted = useState('demo-poll-started', () => false)
  const knownTaskStatus = useState<Record<string, string>>('known-task-status', () => ({}))

  async function refresh(options: { quiet?: boolean } = {}) {
    if (loading.value) return state.value
    loading.value = true
    try {
      const next = await $fetch<DemoState>('/api/state')
      if (initialized.value && import.meta.client) {
        for (const task of next.tasks) {
          const before = knownTaskStatus.value[task.id]
          if (before && before !== task.status && task.status === 'completed') {
            Notification.success({ title: 'Agent 任务已完成', content: task.currentStep || '结果已同步到业务页面', duration: 4500 })
          }
          if (before && before !== task.status && task.status === 'failed') {
            Notification.error({ title: 'Agent 任务失败', content: task.error || '请在 Agent 任务中心查看并重试', duration: 6000 })
          }
        }
      }
      knownTaskStatus.value = Object.fromEntries(next.tasks.map(task => [task.id, task.status]))

      // 空闲轮询通常会返回完全相同的数据。避免每次都替换全局响应式对象，
      // 否则 Select / Dropdown 等依赖焦点的浮层在部分浏览器中会被重渲染打断。
      if (!state.value || JSON.stringify(state.value) !== JSON.stringify(next)) state.value = next
      initialized.value = true
      return next
    } catch (error: any) {
      if (!options.quiet && import.meta.client) Message.error(error?.data?.statusMessage || '数据加载失败，请稍后重试')
      throw error
    } finally {
      loading.value = false
    }
  }

  async function runAgent(mode: AgentMode, targetType: string, targetId: string, input: Record<string, any> = {}) {
    try {
      const result = await $fetch<any>('/api/agent/tasks', { method: 'POST', body: { mode, targetType, targetId, input } })
      if (result.duplicate) Message.warning('相同对象的 Agent 任务正在运行，请勿重复触发')
      else Message.info('Agent 已开始运行，页面会自动更新进度和结果')
      await refresh({ quiet: true })
      return result
    } catch (error: any) {
      Message.error(error?.data?.statusMessage || 'Agent 启动失败，请稍后重试')
      throw error
    }
  }

  async function doAction(action: string, id = '', data: Record<string, any> = {}, successMessage = '操作成功') {
    try {
      const result = await $fetch<any>('/api/demo/action', { method: 'POST', body: { action, id, data } })
      Message.success(successMessage)
      await refresh({ quiet: true })
      return result
    } catch (error: any) {
      Message.error(error?.data?.statusMessage || error?.statusMessage || '操作失败，请稍后重试')
      throw error
    }
  }

  async function resetDemo() {
    await $fetch('/api/demo/reset', { method: 'POST' })
    Message.success('演示数据已恢复到初始状态')
    await refresh({ quiet: true })
  }

  async function advanceTime(days = 3) {
    const result = await $fetch<any>('/api/demo/advance-time', { method: 'POST', body: { days } })
    Message.success(`演示时间已推进 ${days} 天`)
    await refresh({ quiet: true })
    return result
  }

  if (import.meta.client && !pollStarted.value) {
    pollStarted.value = true
    window.setInterval(() => {
      if (document.visibilityState !== 'visible') return

      const hasRunningTask = state.value?.tasks.some(task =>
        ['queued', 'running', 'waiting'].includes(task.status)
      )
      const activeElement = document.activeElement as HTMLElement | null
      const userIsEditing = Boolean(activeElement?.closest(
        'input, textarea, [contenteditable="true"], .arco-select-view, .arco-picker'
      ))
      const hasOpenPopup = Array.from(document.querySelectorAll<HTMLElement>('.arco-trigger-popup'))
        .some(element => {
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })

      // Agent 运行时维持高频进度更新；用户正在操作表单或弹层时暂缓一次，
      // 避免下拉框被轮询抢走焦点。无运行任务时页面不需要持续重拉全量状态。
      if (hasRunningTask && !userIsEditing && !hasOpenPopup) {
        void refresh({ quiet: true }).catch(() => undefined)
      }
    }, 1500)
  }

  return { state, loading, refresh, runAgent, doAction, resetDemo, advanceTime }
}
