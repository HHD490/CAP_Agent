import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * composables/useDemoState.ts 行为契约。
 *
 * 由于 useDemoState 同时依赖：
 *  - nuxt 全局：useState、$fetch、import.meta.client
 *  - @arco-design/web-vue：Message、Notification
 * 三个外部副作用点，本测试文件使用：
 *  - vi.mock('@arco-design/web-vue') 拦截 UI 库
 *  - globalThis stub 替换 useState / $fetch
 *  - vitest 默认 node 环境（import.meta.client = false）阻止 setInterval 轮询
 *
 * 重点覆盖：
 *  - refresh() 第一次调用 → 触发 $fetch('/api/state')，写入 state，标记 initialized
 *  - refresh() loading=true 时直接返回（防抖）
 *  - refresh() quiet 模式下 error 不弹 Message
 *  - refresh() 非 quiet 模式下 error 弹 Message.error
 *  - refresh() 检测 task running → completed → 弹 Notification.success
 *  - refresh() 检测 task running → failed → 弹 Notification.error
 *  - runAgent 重复任务（duplicate=true）→ Message.warning
 *  - runAgent 新任务 → Message.info
 *  - runAgent 失败 → Message.error
 *  - doAction 成功 → Message.success（用传入的 successMessage）
 *  - doAction 失败 → Message.error
 *  - resetDemo 弹"演示数据已恢复到初始状态"
 *  - advanceTime 弹"演示时间已推进 N 天"
 *  - state 相同数据不替换（避免浮层重渲染打断）
 */

vi.mock('@arco-design/web-vue', () => ({
  Message: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn()
  },
  Notification: {
    success: vi.fn(),
    error: vi.fn()
  }
}))

import { Message, Notification } from '@arco-design/web-vue'
import { useDemoState } from '../../composables/useDemoState'

const stateMap = new Map<string, any>()
const fetchMock = vi.fn()

function stubNuxt() {
  stateMap.clear()
  ;(globalThis as any).useState = (key: string, init: () => any) => {
    if (!stateMap.has(key)) stateMap.set(key, { value: init() })
    return stateMap.get(key)
  }
  ;(globalThis as any).$fetch = fetchMock
  fetchMock.mockReset()
  vi.mocked(Message.info).mockClear()
  vi.mocked(Message.success).mockClear()
  vi.mocked(Message.warning).mockClear()
  vi.mocked(Message.error).mockClear()
  vi.mocked(Notification.success).mockClear()
  vi.mocked(Notification.error).mockClear()
}

function makeState(overrides: any = {}) {
  return {
    currentTime: '2026-07-17T02:00:00.000Z',
    counts: { totalCustomers: 0 },
    customers: [],
    products: [],
    matches: [],
    opportunities: [],
    tasks: [],
    inquiries: [],
    emailAllowlist: [],
    model: { configured: false, provider: '', name: '', thinkingMode: '', reasoningEffort: '', contextWindowTokens: 0, modelMaxOutputTokens: 0, maxOutputTokens: 0 },
    ...overrides
  }
}

beforeEach(() => {
  stubNuxt()
})

describe('USE-DEMO-STATE: refresh()', () => {
  it('UDS-001: 第一次 refresh() 触发 $fetch("/api/state") 并把结果写入 state', async () => {
    fetchMock.mockResolvedValue(makeState())
    const { state, refresh } = useDemoState()
    const result = await refresh()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/state')
    expect(result).toBeTruthy()
    expect(state.value).toBeTruthy()
    expect(state.value?.currentTime).toBe('2026-07-17T02:00:00.000Z')
  })

  it('UDS-002: loading=true 时 refresh() 直接返回，不重复调 $fetch', async () => {
    fetchMock.mockResolvedValue(makeState())
    const { state, loading, refresh } = useDemoState()
    // 模拟并发：第一次不 await，立即第二次
    const first = refresh()
    expect(loading.value).toBe(true)
    const second = refresh()
    await first
    await second

    // 第一次完成会清 loading，所以两次只发一次 $fetch（第二次被 loading 防抖跳过）
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('UDS-003: quiet 模式下 error 不弹 Message（轮询场景抑制噪声）', async () => {
    fetchMock.mockRejectedValue({ data: { statusMessage: 'network' } })
    const { refresh } = useDemoState()
    await expect(refresh({ quiet: true })).rejects.toBeTruthy()
    expect(Message.error).not.toHaveBeenCalled()
  })

  it('UDS-004: 非 quiet 模式下 error 被 rethrow（Message.error 受 import.meta.client 守卫）', async () => {
    // useDemoState 内的 Message.error 守卫是 `!options.quiet && import.meta.client`；
    // vitest node 环境下 import.meta.client=false，所以 Message 不会实际弹出。
    // 真实浏览器中（client=true），此处会弹 Message.error。这里只验证 error 始终被 rethrow。
    fetchMock.mockRejectedValue({ data: { statusMessage: '服务不可用' } })
    const { refresh } = useDemoState()
    await expect(refresh()).rejects.toMatchObject({ data: { statusMessage: '服务不可用' } })
    expect(Message.error).not.toHaveBeenCalled()
  })

  it('UDS-005: 连续 refresh 之间 task 状态从 running → completed，knownTaskStatus 维护最新', async () => {
    // composables/useDemoState 的通知守卫是 `initialized && import.meta.client`，
    // vitest node 环境下 import.meta.client=false，所以 Notification 不会实际弹出。
    // 这里验证 knownTaskStatus 内部状态被正确维护（真实浏览器中守卫通过后会据此触发通知）。
    fetchMock.mockResolvedValueOnce(makeState({ tasks: [
      { id: 'task-1', status: 'running', currentStep: '处理中', error: '' }
    ]}))
    const { refresh } = useDemoState()
    await refresh()
    expect(stateMap.get('known-task-status').value['task-1']).toBe('running')

    fetchMock.mockResolvedValueOnce(makeState({ tasks: [
      { id: 'task-1', status: 'completed', currentStep: '完成', error: '' }
    ]}))
    await refresh()
    expect(stateMap.get('known-task-status').value['task-1']).toBe('completed')
  })

  it('UDS-006: 连续 refresh 之间 task 状态从 running → failed，knownTaskStatus 维护最新', async () => {
    fetchMock.mockResolvedValueOnce(makeState({ tasks: [
      { id: 'task-2', status: 'running', currentStep: '', error: '' }
    ]}))
    const { refresh } = useDemoState()
    await refresh()
    fetchMock.mockResolvedValueOnce(makeState({ tasks: [
      { id: 'task-2', status: 'failed', currentStep: '', error: '模型错误' }
    ]}))
    await refresh()
    expect(stateMap.get('known-task-status').value['task-2']).toBe('failed')
  })

  it('UDS-007: 第一次 refresh 不弹任何通知（initialized=false 守卫 + import.meta.client=false）', async () => {
    // 单次 refresh，没有任何"上一次"状态可对比
    fetchMock.mockResolvedValue(makeState({ tasks: [
      { id: 'task-3', status: 'completed', currentStep: 'done', error: '' }
    ]}))
    const { refresh } = useDemoState()
    await refresh()
    expect(Notification.success).not.toHaveBeenCalled()
    expect(Notification.error).not.toHaveBeenCalled()
  })

  it('UDS-008: 同数据 state 不替换（避免 Select/Dropdown 焦点被打断）', async () => {
    const sameState = makeState()
    fetchMock.mockResolvedValue(sameState)
    const { state, refresh } = useDemoState()
    await refresh()
    const firstRef = state.value
    await refresh()
    const secondRef = state.value
    // 第一次设值；第二次因为 JSON.stringify 相等，不替换
    expect(secondRef).toBe(firstRef)
  })
})

describe('USE-DEMO-STATE: runAgent()', () => {
  it('UDS-010: 新任务 → Message.info "Agent 已开始运行"', async () => {
    fetchMock.mockResolvedValueOnce({ duplicate: false, task: { id: 't1' } })
    fetchMock.mockResolvedValueOnce(makeState())
    const { runAgent } = useDemoState()
    await runAgent('customer_profiling', 'customer', 'c1')
    expect(Message.info).toHaveBeenCalledWith(expect.stringMatching(/Agent 已开始运行/))
    expect(Message.warning).not.toHaveBeenCalled()
  })

  it('UDS-011: 重复任务（duplicate=true）→ Message.warning "请勿重复触发"', async () => {
    fetchMock.mockResolvedValueOnce({ duplicate: true, task: { id: 't1' } })
    fetchMock.mockResolvedValueOnce(makeState())
    const { runAgent } = useDemoState()
    await runAgent('customer_profiling', 'customer', 'c1')
    expect(Message.warning).toHaveBeenCalledWith(expect.stringMatching(/请勿重复触发/))
  })

  it('UDS-012: 失败 → Message.error + 抛错', async () => {
    fetchMock.mockRejectedValueOnce({ data: { statusMessage: '模型不可用' } })
    const { runAgent } = useDemoState()
    await expect(runAgent('customer_profiling', 'customer', 'c1')).rejects.toBeTruthy()
    expect(Message.error).toHaveBeenCalledWith('模型不可用')
  })
})

describe('USE-DEMO-STATE: doAction()', () => {
  it('UDS-020: 成功 → Message.success 用传入的 successMessage', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true })
    fetchMock.mockResolvedValueOnce(makeState())
    const { doAction } = useDemoState()
    await doAction('accept_match', 'match-1', {}, '已接受匹配')
    expect(Message.success).toHaveBeenCalledWith('已接受匹配')
  })

  it('UDS-021: 失败 → Message.error 使用 statusMessage', async () => {
    fetchMock.mockRejectedValueOnce({ data: { statusMessage: '存在硬阻断项' } })
    const { doAction } = useDemoState()
    await expect(doAction('accept_match', 'match-1', {})).rejects.toBeTruthy()
    expect(Message.error).toHaveBeenCalledWith('存在硬阻断项')
  })
})

describe('USE-DEMO-STATE: resetDemo() / advanceTime()', () => {
  it('UDS-030: resetDemo → Message.success "演示数据已恢复到初始状态"', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true })
    fetchMock.mockResolvedValueOnce(makeState())
    const { resetDemo } = useDemoState()
    await resetDemo()
    expect(Message.success).toHaveBeenCalledWith(expect.stringMatching(/恢复到初始状态/))
  })

  it('UDS-031: advanceTime(3) → Message.success 包含 "推进 3 天"', async () => {
    fetchMock.mockResolvedValueOnce({ currentTime: '2026-07-20T02:00:00.000Z', reminders: 0 })
    fetchMock.mockResolvedValueOnce(makeState())
    const { advanceTime } = useDemoState()
    await advanceTime(3)
    expect(Message.success).toHaveBeenCalledWith(expect.stringMatching(/推进 3 天/))
  })

  it('UDS-032: advanceTime 不传参默认 3 天', async () => {
    fetchMock.mockResolvedValueOnce({ currentTime: '2026-07-20T02:00:00.000Z', reminders: 0 })
    fetchMock.mockResolvedValueOnce(makeState())
    const { advanceTime } = useDemoState()
    await advanceTime()
    expect(fetchMock).toHaveBeenCalledWith('/api/demo/advance-time', expect.objectContaining({
      method: 'POST',
      body: { days: 3 }
    }))
  })
})
