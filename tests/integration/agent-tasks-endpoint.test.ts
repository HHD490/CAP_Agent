import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { useIsolatedDb } from '../helpers/db'
import tasksPostHandler from '../../server/api/agent/tasks.post'
import stopPostHandler from '../../server/api/agent/tasks/[id]/stop.post'

/**
 * /api/agent/tasks 和 /api/agent/tasks/[id]/stop 的 HTTP 入口契约测试。
 *
 * 业务规则（来自 server/api/agent/tasks.post.ts + stop.post.ts）：
 *  - tasks.post: body 必填 mode/targetType/targetId，input 可选；mode 必须是 5 个合法值
 *  - tasks.post: 缺字段或非法 mode → zod 抛错（HTTP 500 默认）
 *  - stop.post: 缺 id 段 → stopAgentTask("") 抛"任务不存在"
 *  - tasks.post + stop.post: duplicate 检测仍然生效
 */
describe('AGENT-TASKS-ENDPOINT: /api/agent/tasks', () => {
  it('TASKS-001: 合法 body → 返回 task + duplicate=false', async () => {
    useIsolatedDb()
    const result = await tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer', targetId: 'customer-wca-01', input: { autoMatch: false } } } as any)
    expect(result.task).toBeTruthy()
    expect(result.duplicate).toBe(false)
    expect(result.task.mode).toBe('customer_profiling')
    expect(result.task.target_id).toBe('customer-wca-01')
  })

  it('TASKS-002: 缺 mode → zod 抛错', async () => {
    useIsolatedDb()
    await expect(tasksPostHandler({ __body: { targetType: 'customer', targetId: 'customer-wca-01' } } as any)).rejects.toBeInstanceOf(ZodError)
  })

  it('TASKS-003: 缺 targetType → zod 抛错', async () => {
    useIsolatedDb()
    await expect(tasksPostHandler({ __body: { mode: 'customer_profiling', targetId: 'customer-wca-01' } } as any)).rejects.toBeInstanceOf(ZodError)
  })

  it('TASKS-004: 缺 targetId → zod 抛错', async () => {
    useIsolatedDb()
    await expect(tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer' } } as any)).rejects.toBeInstanceOf(ZodError)
  })

  it('TASKS-005: targetId 空串 → zod 抛错', async () => {
    useIsolatedDb()
    await expect(tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer', targetId: '' } } as any)).rejects.toBeInstanceOf(ZodError)
  })

  it('TASKS-006: 非法 mode → zod 抛错', async () => {
    useIsolatedDb()
    await expect(tasksPostHandler({ __body: { mode: 'mystery_mode', targetType: 'customer', targetId: 'customer-wca-01' } } as any)).rejects.toBeInstanceOf(ZodError)
  })

  it.each(['customer_profiling', 'product_matching', 'outreach_drafting', 'reply_qualification', 'handoff_summary'])(
    'TASKS-007-%s: 5 个合法 mode 全部接受',
    async (mode) => {
      const { db } = useIsolatedDb()
      const result = await tasksPostHandler({ __body: { mode, targetType: 'customer', targetId: 'customer-wca-01' } } as any)
      expect(result.task).toBeTruthy()
      expect(result.task.mode).toBe(mode)
      // 清理避免影响下一个 case 的去重
      db.prepare(`DELETE FROM agent_task_steps WHERE task_id = ?`).run(result.task.id)
      db.prepare(`DELETE FROM agent_tasks WHERE id = ?`).run(result.task.id)
    }
  )

  it('TASKS-008: input 缺省 → 默认 {}', async () => {
    const { db } = useIsolatedDb()
    const result = await tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer', targetId: 'customer-wca-02' } } as any)
    const row = db.prepare('SELECT input_json FROM agent_tasks WHERE id = ?').get(result.task.id) as any
    expect(row.input_json).toBe('{}')
  })

  it('TASKS-009: input 传非对象（字符串）→ zod 抛错', async () => {
    useIsolatedDb()
    await expect(tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer', targetId: 'customer-wca-01', input: 'not an object' as any } } as any)).rejects.toBeInstanceOf(ZodError)
  })

  it('TASKS-010: input 传数组 → zod 抛错（必须是 record）', async () => {
    useIsolatedDb()
    await expect(tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer', targetId: 'customer-wca-01', input: [] as any } } as any)).rejects.toBeInstanceOf(ZodError)
  })

  it('TASKS-011: 同一目标第二次创建 → duplicate=true', async () => {
    useIsolatedDb()
    const first = await tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer', targetId: 'customer-wca-01' } } as any)
    const second = await tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer', targetId: 'customer-wca-01' } } as any)
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.task.id).toBe(first.task.id)
  })
})

describe('AGENT-TASKS-ENDPOINT: /api/agent/tasks/[id]/stop', () => {
  it('STOP-001: 停止 queued 任务 → status=stopped', async () => {
    const { db } = useIsolatedDb()
    const { task } = await tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer', targetId: 'customer-wca-01' } } as any)
    const result = await stopPostHandler({ __params: { id: task.id } } as any) as any
    expect(result.status).toBe('stopped')
  })

  it('STOP-002: 不存在 task → 抛 "任务不存在"', async () => {
    useIsolatedDb()
    let captured: any = null
    try {
      await stopPostHandler({ __params: { id: 'task-nope' } } as any)
    } catch (e) {
      captured = e
    }
    expect(captured).toBeTruthy()
    expect(String(captured)).toMatch(/任务不存在/)
  })

  it('STOP-002b: id 段缺失 → 当作空串处理 → 抛 "任务不存在"', async () => {
    useIsolatedDb()
    let captured: any = null
    try {
      await stopPostHandler({} as any)
    } catch (e) {
      captured = e
    }
    expect(captured).toBeTruthy()
    expect(String(captured)).toMatch(/任务不存在/)
  })

  it('STOP-003: 通过 stopAgentTask 工具（绕开 router）测核心逻辑', async () => {
    // 上面 endpoint 的 stop 实现最终调用 stopAgentTask
    // 这里直接验证工具函数行为
    const { stopAgentTask } = await import('../../server/utils/agent')
    const { db } = useIsolatedDb()
    const { task } = await tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer', targetId: 'customer-wca-02' } } as any)
    const stopped = stopAgentTask(task.id) as any
    expect(stopped.status).toBe('stopped')
    const row = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('stopped')
  })
})
