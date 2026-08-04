import { describe, expect, it } from 'vitest'
import { useIsolatedDb } from '../helpers/db'
import { createAgentTask, stopAgentTask } from '../../server/utils/agent'
import tasksPostHandler from '../../server/api/agent/tasks.post'
import stopPostHandler from '../../server/api/agent/tasks/[id]/stop.post'

/**
 * server/utils/agent.ts 的 createAgentTask / stopAgentTask 边缘行为。
 *
 * 已有 TASKS-* / STOP-* (agent-tasks-endpoint.test.ts) 覆盖了：
 *  - 5 个合法 mode、zod 校验、dedup、stop queued 任务
 *
 * 本文件补：
 *  - 同一 (targetType, targetId) 不同 mode → 各自独立（不互串）
 *  - stop 已 completed / failed / stopped 的任务 → 不抛错，直接返回原 task
 *  - stop 之后再创建同 (mode, target) → 不被 dedup，分配新 task
 *  - createAgentTask 写入 agent_task_steps 起步 step
 *  - stopAgentTask 写入一条 'stopped' step
 *  - 重复 create 在 defer 模式下不自动触发执行（仅创建 task 行）
 */
describe('TASKS-EDGE: createAgentTask / stopAgentTask boundaries', () => {
  it('EDGE-001: 同一 (targetType, targetId) 不同 mode 各自独立（不互串）', () => {
    useIsolatedDb()
    const a = createAgentTask('customer_profiling', 'customer', 'customer-wca-01')
    const b = createAgentTask('product_matching', 'customer', 'customer-wca-01')
    const c = createAgentTask('outreach_drafting', 'opportunity', 'opp-01')

    expect(a.duplicate).toBe(false)
    expect(b.duplicate).toBe(false)
    expect(c.duplicate).toBe(false)
    expect(a.task.id).not.toBe(b.task.id)
    expect(b.task.id).not.toBe(c.task.id)
    expect(a.task.mode).toBe('customer_profiling')
    expect(b.task.mode).toBe('product_matching')
  })

  it('EDGE-002: stop 一个 completed 任务 → 不抛错，直接返回原 task', () => {
    const { db } = useIsolatedDb()
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-01')
    // 手工把它改成 completed
    db.prepare(`UPDATE agent_tasks SET status = 'completed', phase = 'completed', progress = 100, completed_at = ? WHERE id = ?`)
      .run('2026-07-17T02:00:00.000Z', task.id)

    const stopped = stopAgentTask(task.id) as any
    expect(stopped.id).toBe(task.id)
    expect(stopped.status).toBe('completed') // 状态不被覆盖

    const row = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('completed')
  })

  it('EDGE-003: stop 一个已 stopped 任务 → 不抛错', () => {
    const { db } = useIsolatedDb()
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-02')
    stopAgentTask(task.id)
    // 第二次 stop
    expect(() => stopAgentTask(task.id)).not.toThrow()
    const row = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(task.id) as any
    expect(row.status).toBe('stopped')
  })

  it('EDGE-004: stop 一个 failed 任务 → 不抛错（不复活）', () => {
    const { db } = useIsolatedDb()
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-03')
    db.prepare(`UPDATE agent_tasks SET status = 'failed', phase = 'failed', error = 'old error' WHERE id = ?`).run(task.id)

    const stopped = stopAgentTask(task.id) as any
    expect(stopped.status).toBe('failed')
    expect(stopped.error).toBe('old error')
  })

  it('EDGE-005: stop 之后再 create 同 (mode, targetType, targetId) → 分配新 task，不被 dedup', () => {
    const { db } = useIsolatedDb()
    const first = createAgentTask('customer_profiling', 'customer', 'customer-wca-04')
    stopAgentTask(first.task.id)
    const second = createAgentTask('customer_profiling', 'customer', 'customer-wca-04')

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(false) // 关键：stopped 状态不参与 dedup
    expect(second.task.id).not.toBe(first.task.id)

    const ids = (db.prepare(`SELECT id FROM agent_tasks WHERE target_id = 'customer-wca-04' ORDER BY created_at`).all() as any[]).map(r => r.id)
    expect(ids).toEqual([first.task.id, second.task.id])
  })

  it('EDGE-006: createAgentTask 写入一条起步 step（sequence=1, phase=requesting）', () => {
    const { db } = useIsolatedDb()
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-05')

    const steps = db.prepare(`SELECT sequence, phase, summary FROM agent_task_steps WHERE task_id = ? ORDER BY sequence`).all(task.id) as any[]
    expect(steps).toHaveLength(1)
    expect(steps[0].sequence).toBe(1)
    expect(steps[0].phase).toBe('requesting')
    expect(steps[0].summary).toMatch(/等待模型/)
  })

  it('EDGE-007: stopAgentTask 额外写入一条 stopped step（sequence=2）', () => {
    const { db } = useIsolatedDb()
    const { task } = createAgentTask('customer_profiling', 'customer', 'customer-wca-06')
    stopAgentTask(task.id)

    const steps = db.prepare(`SELECT sequence, phase, summary FROM agent_task_steps WHERE task_id = ? ORDER BY sequence`).all(task.id) as any[]
    expect(steps).toHaveLength(2)
    expect(steps[1].sequence).toBe(2)
    expect(steps[1].phase).toBe('stopped')
    expect(steps[1].summary).toMatch(/停止/)
  })

  it('EDGE-008: 重复 create 第二个的 task id 与第一个完全相同（dedup 命中）', () => {
    useIsolatedDb()
    const first = createAgentTask('customer_profiling', 'customer', 'customer-wca-07')
    const second = createAgentTask('customer_profiling', 'customer', 'customer-wca-07')
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.task.id).toBe(first.task.id)
    expect(second.task.created_at).toBe(first.task.created_at)
  })

  it('EDGE-009: HTTP 入口（tasks.post）dedup 行为与工具函数一致', async () => {
    useIsolatedDb()
    const first = await tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer', targetId: 'customer-wca-08' } } as any) as any
    const second = await tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer', targetId: 'customer-wca-08' } } as any) as any
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.task.id).toBe(first.task.id)
  })

  it('EDGE-010: HTTP 入口（stop.post）stop 一个 completed 任务 → 不抛错', async () => {
    const { db } = useIsolatedDb()
    const { task } = await tasksPostHandler({ __body: { mode: 'customer_profiling', targetType: 'customer', targetId: 'customer-wca-09' } } as any) as any
    db.prepare(`UPDATE agent_tasks SET status = 'completed', phase = 'completed', completed_at = ? WHERE id = ?`)
      .run('2026-07-17T02:00:00.000Z', task.id)
    const result = await stopPostHandler({ __params: { id: task.id } } as any) as any
    expect(result.status).toBe('completed')
  })
})
