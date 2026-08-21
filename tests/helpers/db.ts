import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach } from 'vitest'
import {
  initializeDatabaseConnection,
  resetDemoDatabase,
  setDbForTests
} from '../../server/utils/db'
import { resetAgentTestHooks, setDeferAgentExecutionForTests } from '../../server/utils/agent'

type Cleanup = () => void

const cleanups: Cleanup[] = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
  setDbForTests(undefined)
  resetAgentTestHooks()
  setDeferAgentExecutionForTests(false)
})

export function useIsolatedDb(seed = true) {
  const dir = mkdtempSync(join(tmpdir(), 'cap-agent-test-'))
  const path = join(dir, 'test.sqlite')
  const db = new DatabaseSync(path)
  initializeDatabaseConnection(db, { seed })
  if (seed) resetDemoDatabase(db)
  setDbForTests(db)
  setDeferAgentExecutionForTests(true)

  const cleanup = () => {
    try { db.close() } catch { /* already closed */ }
    setDbForTests(undefined)
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
  cleanups.push(cleanup)
  return { db, path, dir }
}
