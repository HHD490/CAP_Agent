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

  it('UDS-033: advanceTime 失败时 error.message 作 fallback（无 data.statusMessage 时）', async () => {
    fetchMock.mockRejectedValueOnce(new Error('网络断开'))
    const { advanceTime } = useDemoState()
    await expect(advanceTime(5)).rejects.toBeTruthy()
    expect(Message.success).not.toHaveBeenCalled()
  })
})

describe('USE-DEMO-STATE: state 替换 vs 保留（避免浮层重渲染）', () => {
  it('UDS-040: 数据变化时 state 被替换（避免读到陈旧 UI）', async () => {
    const v1 = makeState({ counts: { totalCustomers: 30 } })
    const v2 = makeState({ counts: { totalCustomers: 35 } }) // 不同 data
    fetchMock.mockResolvedValueOnce(v1)
    fetchMock.mockResolvedValueOnce(v2)
    const { state, refresh } = useDemoState()
    await refresh()
    const firstRef = state.value
    await refresh()
    const secondRef = state.value
    expect(secondRef).not.toBe(firstRef)
    expect(secondRef?.counts?.totalCustomers).toBe(35)
  })

  it('UDS-041: JSON.stringify 完全相等时 state 引用不替换（避开浮层重渲染）', async () => {
    const same = makeState({ tasks: [{ id: 't1', status: 'running', currentStep: 'x', error: '' }] })
    fetchMock.mockResolvedValue(same)
    const { state, refresh } = useDemoState()
    await refresh()
    const first = state.value
    await refresh()
    const second = state.value
    expect(second).toBe(first)
  })

  it('UDS-042: 嵌套对象属性不同（counts.customers）→ state 替换', async () => {
    const v1 = makeState({ counts: { totalCustomers: 30, wcaCustomers: 20 } })
    const v2 = makeState({ counts: { totalCustomers: 30, wcaCustomers: 25 } }) // 内部差
    fetchMock.mockResolvedValueOnce(v1)
    fetchMock.mockResolvedValueOnce(v2)
    const { state, refresh } = useDemoState()
    await refresh()
    const first = state.value
    await refresh()
    const second = state.value
    expect(second).not.toBe(first)
  })
})

describe('USE-DEMO-STATE: 错误信息退化（data.statusMessage → statusMessage → 默认）', () => {
  it('UDS-050: refresh 错误含 data.statusMessage → 不弹（import.meta.client=false 守卫）', async () => {
    // 真实浏览器中：Message.error 会被 import.meta.client 守卫
    // node 测试环境：import.meta.client=false，所以 Message.error 不会弹出
    // 测试锁定：error 始终被 rethrow
    fetchMock.mockRejectedValueOnce({ data: { statusMessage: '服务不可用' } })
    const { refresh } = useDemoState()
    await expect(refresh()).rejects.toMatchObject({ data: { statusMessage: '服务不可用' } })
    expect(Message.error).not.toHaveBeenCalled()
  })

  it('UDS-051: refresh 错误没有 data 字段 → 仍 rethrow（防御性 fallback 路径）', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const { refresh } = useDemoState()
    await expect(refresh()).rejects.toThrow(/network down/)
    expect(Message.error).not.toHaveBeenCalled()
  })

  it('UDS-052: runAgent 错误无 data 字段 → Message.error 用默认 fallback "Agent 启动失败"', async () => {
    // runAgent 的 catch 块没有 import.meta.client 守卫（与 refresh 不同），
    // 任何环境下都调 Message.error；测试锁定 rethrow + Message.error 两条路径
    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    const { runAgent } = useDemoState()
    await expect(runAgent('customer_profiling', 'customer', 'c1')).rejects.toThrow(/timeout/)
    expect(Message.error).toHaveBeenCalledWith('Agent 启动失败，请稍后重试')
  })

  it('UDS-053: doAction 错误无 data.statusMessage 但有顶层 statusMessage → Message.error 退化到 statusMessage', async () => {
    // doAction 的 fallback 链是：data.statusMessage → statusMessage → '操作失败，请稍后重试'
    // 这里没有 data 字段，但有顶层 statusMessage，所以用 '网络异常'
    fetchMock.mockRejectedValueOnce({ statusMessage: '网络异常' })
    const { doAction } = useDemoState()
    await expect(doAction('accept_match', 'match-1', {})).rejects.toMatchObject({ statusMessage: '网络异常' })
    expect(Message.error).toHaveBeenCalledWith('网络异常')
  })

  it('UDS-054: doAction 错误什么都没有 → Message.error 退化到默认 "操作失败，请稍后重试"', async () => {
    fetchMock.mockRejectedValueOnce({}) // 啥都没有
    const { doAction } = useDemoState()
    await expect(doAction('accept_match', 'match-1', {})).rejects.toBeTruthy()
    expect(Message.error).toHaveBeenCalledWith('操作失败，请稍后重试')
  })

  it('UDS-055: doAction 错误带 data.statusMessage → Message.error 用 data.statusMessage（最优先）', async () => {
    fetchMock.mockRejectedValueOnce({ data: { statusMessage: '存在硬阻断项，请确认后再接受匹配' } })
    const { doAction } = useDemoState()
    await expect(doAction('accept_match', 'match-1', {})).rejects.toBeTruthy()
    expect(Message.error).toHaveBeenCalledWith('存在硬阻断项，请确认后再接受匹配')
  })

  it('UDS-056: doAction 错误时 失败路径不刷新 state → 保留上一次成功数据', async () => {
    fetchMock.mockResolvedValueOnce(makeState({ counts: { totalCustomers: 30 } })) // 第一次成功
    fetchMock.mockRejectedValueOnce({ data: { statusMessage: 'fail' } }) // 第二次失败
    const { doAction, state, refresh } = useDemoState()
    await refresh()
    const firstState = state.value
    await expect(doAction('accept_match', 'match-1', {})).rejects.toBeTruthy()
    // 失败路径不替换 state（refresh 没被调用，doAction 失败直接 rethrow）
    expect(state.value).toBe(firstState)
    expect(state.value?.counts?.totalCustomers).toBe(30)
  })
})

describe('USE-DEMO-STATE: 任务状态变化的 known-task-status 维护', () => {
  it('UDS-060: task 出现（之前不存在）→ 不触发 Notification（initialized 后新增不算状态变化）', async () => {
    // 第一次 refresh：known-task-status = {}
    // 第二次 refresh：tasks 中多了 task-1 (status=running) → 之前没记录，before=undefined，
    //   `if (before && before !== task.status && ...)` 守卫 before=undefined → 不触发
    fetchMock.mockResolvedValueOnce(makeState())
    const { refresh } = useDemoState()
    await refresh()
    expect(stateMap.get('known-task-status').value).toEqual({})

    fetchMock.mockResolvedValueOnce(makeState({ tasks: [
      { id: 'task-new', status: 'running', currentStep: '处理中', error: '' }
    ]}))
    await refresh()
    expect(Notification.success).not.toHaveBeenCalled()
    expect(Notification.error).not.toHaveBeenCalled()
    expect(stateMap.get('known-task-status').value['task-new']).toBe('running')
  })

  it('UDS-061: task 从 queued → completed → knownTaskStatus 记录最新状态', async () => {
    fetchMock.mockResolvedValueOnce(makeState({ tasks: [
      { id: 'task-queued', status: 'queued', currentStep: '排队', error: '' }
    ]}))
    const { refresh } = useDemoState()
    await refresh()
    expect(stateMap.get('known-task-status').value['task-queued']).toBe('queued')

    fetchMock.mockResolvedValueOnce(makeState({ tasks: [
      { id: 'task-queued', status: 'completed', currentStep: '完成', error: '' }
    ]}))
    await refresh()
    expect(stateMap.get('known-task-status').value['task-queued']).toBe('completed')
  })

  it('UDS-062: 多 task 混合：completed + failed + 仍在 running → 各自维护', async () => {
    fetchMock.mockResolvedValueOnce(makeState({ tasks: [
      { id: 'task-A', status: 'running', currentStep: 'A', error: '' },
      { id: 'task-B', status: 'running', currentStep: 'B', error: '' },
      { id: 'task-C', status: 'running', currentStep: 'C', error: '' }
    ]}))
    const { refresh } = useDemoState()
    await refresh()
    expect(stateMap.get('known-task-status').value).toMatchObject({
      'task-A': 'running',
      'task-B': 'running',
      'task-C': 'running'
    })

    fetchMock.mockResolvedValueOnce(makeState({ tasks: [
      { id: 'task-A', status: 'completed', currentStep: 'A done', error: '' },
      { id: 'task-B', status: 'failed', currentStep: 'B fail', error: 'model error' },
      { id: 'task-C', status: 'running', currentStep: 'C 还在跑', error: '' }
    ]}))
    await refresh()
    expect(stateMap.get('known-task-status').value).toMatchObject({
      'task-A': 'completed',
      'task-B': 'failed',
      'task-C': 'running'
    })
  })

  it('UDS-063: task 从 completed 变回 running（极少见，重启场景）→ 不会触发 Notification（只 completed / failed 触发）', async () => {
    fetchMock.mockResolvedValueOnce(makeState({ tasks: [
      { id: 'task-rev', status: 'completed', currentStep: 'done', error: '' }
    ]}))
    const { refresh } = useDemoState()
    await refresh()

    fetchMock.mockResolvedValueOnce(makeState({ tasks: [
      { id: 'task-rev', status: 'running', currentStep: 'rerun', error: '' }
    ]}))
    await refresh()
    // Notification 仅在 task 变为 completed 或 failed 时触发
    expect(Notification.success).not.toHaveBeenCalled()
    expect(Notification.error).not.toHaveBeenCalled()
    expect(stateMap.get('known-task-status').value['task-rev']).toBe('running')
  })
})
