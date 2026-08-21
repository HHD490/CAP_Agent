import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { useIsolatedDb } from '../helpers/db'

/**
 * SQLite lock / busy 真不变量 — 跨连接 + 串行 + busy_timeout。
 *
 * 业务背景：
 *  - server/utils/db.ts L193 `PRAGMA journal_mode = WAL`（try/catch）—— 这是 §4 #19 登记的
 *    "WAL 模式失败兜底"，但 0 测试覆盖 BUSY。
 *  - demo reset + Agent run 同窗口撞锁；跨进程写阻塞；任务失败语义。
 *  - 现有 db-utils.test.ts 13 it 0 覆盖 busy。
 *
 * 策略：
 *  - 用 useIsolatedDb() 拿到一个隔离 DB + 文件路径；再开第二个 DatabaseSync 指向同一文件
 *    模拟"跨进程 / 跨连接" 锁竞争。
 *  - node:sqlite 的 DatabaseSync 是同步 API：prepare().run() 会阻塞线程直到锁释放或
 *    busy_timeout 到期，所以可以同步验证 wait 时长。
 *  - 实测：node:sqlite 抛出的错信息为 "database is locked"（含 "locked"），code 为
 *    ERR_SQLITE_ERROR。这里按"含 locked 字样"匹配，兼容未来错误措辞微调。
 */
describe('DB-LOCK-BUSY: SQLite 写锁冲突时调用方行为', () => {
  it('B1: 跨连接 + busy_timeout=0（默认）→ 第二个 writer 立即抛 "database is locked"', () => {
    const ctxA = useIsolatedDb()
    const A = ctxA.db
    const B = new DatabaseSync(ctxA.path)
    B.exec('PRAGMA journal_mode = WAL')
    // 显式 busy_timeout=0（默认值），确保不会被默认 busy_timeout 干扰
    B.exec('PRAGMA busy_timeout = 0')

    try {
      A.exec('BEGIN IMMEDIATE')
      try {
        A.prepare(`INSERT INTO customers (id, name, source, last_activity_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)`)
          .run('lock-busy-b1-a', 'lock busy b1 a', 'system',
               '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z')

        const t0 = Date.now()
        let err: Error | null = null
        try {
          B.prepare(`INSERT INTO customers (id, name, source, last_activity_at, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?)`)
            .run('lock-busy-b1-b', 'lock busy b1 b', 'system',
                 '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z')
        } catch (e) {
          err = e as Error
        }
        const elapsed = Date.now() - t0

        expect(err, 'B should have thrown when A holds BEGIN IMMEDIATE').toBeTruthy()
        expect(err!.message).toMatch(/locked/i)
        // 立即抛（busy_timeout=0 不会让 B 等）
        expect(elapsed).toBeLessThan(100)
      } finally {
        A.exec('ROLLBACK')
      }
    } finally {
      B.close()
    }
  })

  it('B2: 同一连接串行 100 次写 → 永不抛 busy（永不长持锁）', () => {
    const { db } = useIsolatedDb()
    // 100 次串行写：每条 INSERT 自动 commit，没有长事务持锁
    for (let i = 0; i < 100; i++) {
      expect(() =>
        db.prepare(`INSERT INTO customers (id, name, source, last_activity_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)`)
          .run(`lock-busy-b2-${i}`, `serial ${i}`, 'system',
               '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z')
      ).not.toThrow()
    }
    const count = Number((db.prepare(`SELECT COUNT(*) AS c FROM customers WHERE id LIKE 'lock-busy-b2-%'`).get() as any).c)
    expect(count).toBe(100)
  })

  it('B3: 跨连接 + busy_timeout=200 + A 长持锁 → B 等 ~200ms 后抛 "database is locked"', () => {
    const ctxA = useIsolatedDb()
    const A = ctxA.db
    const B = new DatabaseSync(ctxA.path)
    B.exec('PRAGMA journal_mode = WAL')
    B.exec('PRAGMA busy_timeout = 200')

    try {
      A.exec('BEGIN IMMEDIATE')
      A.prepare(`INSERT INTO customers (id, name, source, last_activity_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`)
        .run('lock-busy-b3-a', 'lock busy b3 a', 'system',
             '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z')

      const t0 = Date.now()
      let err: Error | null = null
      try {
        B.prepare(`INSERT INTO customers (id, name, source, last_activity_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)`)
          .run('lock-busy-b3-b', 'lock busy b3 b', 'system',
               '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z', '2026-07-17T02:00:00.000Z')
      } catch (e) {
        err = e as Error
      }
      const elapsed = Date.now() - t0

      expect(err, 'B should have thrown after busy_timeout').toBeTruthy()
      expect(err!.message).toMatch(/locked/i)
      // 关键不变量：B 真的等了 ~200ms 才抛（验证 busy_timeout 真的生效了，不是立即抛）
      // 允许 ±100ms 抖动
      expect(elapsed).toBeGreaterThanOrEqual(150)
      // 但也不会永远等（远小于 busy_timeout 的 N 倍）
      expect(elapsed).toBeLessThan(2000)
    } finally {
      try { A.exec('ROLLBACK') } catch { /* may already be released */ }
      B.close()
    }
  })
})
