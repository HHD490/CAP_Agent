import { describe, expect, it, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertNoNuxtLock,
  assertNoXlsxEsmError,
  assertPortClosed,
  allocateLoopbackPort,
  buildCustomerXlsxBuffer,
  cleanupSmokeRuntime,
  cleanupTempDir,
  createTempDbPath,
  localNodeBin,
  localNpmCmd,
  notePreExistingGreen,
  releaseNuxtLock,
  resolveNuxtBin,
  startProcess,
  waitForUrl,
  writeMultipart
} from '../helpers/nitro-smoke'

const root = resolve(process.cwd())
const isWindows = process.platform === 'win32'

afterEach(async () => {
  // Belt-and-suspenders: never leave a Nuxt lock for the next suite/build.
  releaseNuxtLock(root)
})

describe('IMPORT-XLSX / SMOKE-ENTRY Windows Nitro smoke', () => {
  it.skipIf(!isWindows)('SMOKE-ENTRY-002/003 + IMPORT-XLSX-001/002: nuxt dev state+import', async () => {
    const { dir, dbPath } = createTempDbPath()
    const port = await allocateLoopbackPort()
    const base = `http://127.0.0.1:${port}`
    const memberId = `NITRO-SMOKE-${Date.now()}`
    releaseNuxtLock(root)
    const nuxtBin = resolveNuxtBin(root)
    const proc = startProcess(localNodeBin(), [nuxtBin, 'dev', '--port', String(port), '--host', '127.0.0.1'], {
      DATABASE_PATH: dbPath,
      NITRO_PORT: String(port),
      PORT: String(port)
    }, root)

    try {
      await waitForUrl(`${base}/api/state`, 180_000, { stdout: proc.getStdout, stderr: proc.getStderr })
      const res = await fetch(`${base}/api/state`)
      const text = await res.text()
      expect(res.status, text).toBe(200)
      expect(JSON.parse(text)).toBeTypeOf('object')
      assertNoXlsxEsmError(proc.getStderr() + proc.getStdout())

      const { body, contentType } = writeMultipart(buildCustomerXlsxBuffer(memberId))
      const importRes = await fetch(`${base}/api/import/customers`, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body
      })
      const importJson = await importRes.json()
      expect(importRes.status, JSON.stringify(importJson)).toBe(200)
      expect(importJson.created, JSON.stringify(importJson)).toBe(1)
      assertNoXlsxEsmError(proc.getStderr() + proc.getStdout())
      notePreExistingGreen(`SMOKE-ENTRY-002/003 on port ${port}; Node ${process.version}`)
    } finally {
      await cleanupSmokeRuntime({ cwd: root, port, proc })
      await assertPortClosed(port)
      assertNoNuxtLock(root)
      cleanupTempDir(dir)
      expect(existsSync(dir)).toBe(false)
    }
  }, 300_000)

  it.skipIf(!isWindows)('SMOKE-ENTRY-004/005/006 + IMPORT-XLSX-003: build product state+import and cleanup', async () => {
    const { dir, dbPath } = createTempDbPath()
    const port = await allocateLoopbackPort()
    const base = `http://127.0.0.1:${port}`
    const memberId = `NITRO-BUILD-${Date.now()}`

    // Ensure previous smoke left no lock before invoking nuxt build.
    releaseNuxtLock(root)
    await assertPortClosed(port).catch(() => undefined)

    const build = startProcess(localNpmCmd(root), ['run', 'build'], {
      DATABASE_PATH: dbPath
    }, root)
    const buildCode = await new Promise<number | null>((resolveCode) => {
      build.child.on('exit', (code) => resolveCode(code))
    })
    expect(buildCode, `build failed\nstderr:\n${build.getStderr()}\nstdout:\n${build.getStdout()}`).toBe(0)
    assertNoXlsxEsmError(build.getStderr() + build.getStdout())

    const proc = startProcess(localNodeBin(), ['.output/server/index.mjs'], {
      DATABASE_PATH: dbPath,
      NITRO_PORT: String(port),
      PORT: String(port),
      HOST: '127.0.0.1',
      NITRO_HOST: '127.0.0.1'
    }, root)

    try {
      await waitForUrl(`${base}/api/state`, 120_000, { stdout: proc.getStdout, stderr: proc.getStderr })
      const stateRes = await fetch(`${base}/api/state`)
      expect(stateRes.status).toBe(200)
      expect(await stateRes.json()).toBeTypeOf('object')

      const { body, contentType } = writeMultipart(buildCustomerXlsxBuffer(memberId))
      const importRes = await fetch(`${base}/api/import/customers`, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body
      })
      const importJson = await importRes.json()
      expect(importRes.status, JSON.stringify(importJson)).toBe(200)
      expect(importJson.created, JSON.stringify(importJson)).toBe(1)
      assertNoXlsxEsmError(proc.getStderr() + proc.getStdout())
      notePreExistingGreen(`SMOKE-ENTRY-004 on port ${port}; Node ${process.version}`)
    } finally {
      await cleanupSmokeRuntime({ cwd: root, port, proc })
      await assertPortClosed(port)
      assertNoNuxtLock(root)
      cleanupTempDir(dir)
      expect(existsSync(dir)).toBe(false)
    }
  }, 600_000)
})
