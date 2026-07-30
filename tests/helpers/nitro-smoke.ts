import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createConnection, createServer } from 'node:net'

const XLSX = createRequire(import.meta.url)('xlsx') as typeof import('xlsx')

export function buildCustomerXlsxBuffer(memberId = 'NITRO-SMOKE-001') {
  const sheet = XLSX.utils.json_to_sheet([{
    company: 'Nitro Smoke Co',
    country: '美国',
    city: '西雅图',
    website: 'https://nitro-smoke.example',
    email: 'buyer@nitro-smoke.example',
    contact: 'Nitro Buyer',
    member_id: memberId
  }])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Customers')
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

export async function waitForUrl(url: string, timeoutMs = 120_000, dumps?: { stdout?: () => string, stderr?: () => string }) {
  const started = Date.now()
  let lastError = ''
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status < 500) return res
      lastError = `HTTP ${res.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(r => setTimeout(r, 500))
  }
  const extra = dumps
    ? `\nstderr:\n${dumps.stderr?.() || ''}\nstdout:\n${dumps.stdout?.() || ''}`
    : ''
  throw new Error(`Timed out waiting for ${url}: ${lastError}${extra}`)
}

export function createTempDbPath() {
  const dir = mkdtempSync(join(tmpdir(), 'cap-agent-nitro-'))
  return { dir, dbPath: join(dir, 'smoke.sqlite') }
}

export function resolveNuxtBin(cwd: string) {
  const mjs = join(cwd, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs')
  if (existsSync(mjs)) return mjs
  const candidates = process.platform === 'win32'
    ? [join(cwd, 'node_modules', '.bin', 'nuxt.cmd')]
    : [join(cwd, 'node_modules', '.bin', 'nuxt')]
  const found = candidates.find(path => existsSync(path))
  if (!found) throw new Error(`nuxt binary not found under ${cwd}`)
  return found
}

function killPidTree(pid: number) {
  if (process.platform === 'win32') {
    // Invoke taskkill.exe directly. `shell: true` can misquote arguments on
    // Windows and may report success while leaving Nitro's listener alive.
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    })
    try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
    return
  }
  try { process.kill(-pid, 'SIGKILL') } catch { /* process group may not exist */ }
  try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
}

export function pidsListeningOnPort(port: number): number[] {
  if (process.platform === 'win32') {
    const result = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true })
    const text = `${result.stdout || ''}\n${result.stderr || ''}`
    const pids = new Set<number>()
    for (const line of text.split(/\r?\n/)) {
      if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue
      const parts = line.trim().split(/\s+/)
      const pid = Number(parts[parts.length - 1])
      if (Number.isFinite(pid) && pid > 0) pids.add(pid)
    }
    return [...pids]
  }
  const result = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' })
  return String(result.stdout || '')
    .split(/\s+/)
    .map(Number)
    .filter(pid => Number.isFinite(pid) && pid > 0)
}

export function killListenersOnPort(port: number) {
  for (const pid of pidsListeningOnPort(port)) killPidTree(pid)
}

/** Remove Nuxt lock left by killed dev servers so subsequent builds are not blocked. */
export function releaseNuxtLock(cwd: string) {
  const lockPath = join(cwd, '.nuxt', 'nuxt.lock')
  if (!existsSync(lockPath)) return
  try { unlinkSync(lockPath) } catch { /* best effort */ }
}

export async function cleanupSmokeRuntime(options: {
  cwd: string
  port: number
  proc?: { stop: () => Promise<number | null>, pid?: () => number | undefined }
}) {
  try { await options.proc?.stop() } catch { /* continue cleanup */ }
  const pid = options.proc?.pid?.()
  if (pid) killPidTree(pid)
  killListenersOnPort(options.port)
  releaseNuxtLock(options.cwd)
  // Give Windows a beat to release file handles before npm run build.
  await new Promise(r => setTimeout(r, 800))
  killListenersOnPort(options.port)
  releaseNuxtLock(options.cwd)
}

export function startProcess(command: string, args: string[], env: Record<string, string>, cwd: string) {
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  const executable = needsShell ? (process.env.ComSpec || 'cmd.exe') : command
  const executableArgs = needsShell ? ['/d', '/s', '/c', command, ...args] : args
  const child = spawn(executable, executableArgs, {
    cwd,
    env: { ...process.env, ...env },
    shell: false,
    windowsHide: true
  }) as ChildProcessWithoutNullStreams
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += String(chunk) })
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  child.on('error', (error) => { stderr += `\nspawn error: ${error.message}` })
  return {
    child,
    pid: () => child.pid,
    getStdout: () => stdout,
    getStderr: () => stderr,
    async stop() {
      if (child.exitCode != null) return child.exitCode
      const pid = child.pid
      if (pid) killPidTree(pid)
      await Promise.race([
        new Promise<void>(resolveStop => child.once('exit', () => resolveStop())),
        new Promise<void>(resolveStop => setTimeout(resolveStop, 5000))
      ])
      if (child.exitCode == null && pid) killPidTree(pid)
      return child.exitCode
    }
  }
}

export function cleanupTempDir(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
}

export function writeMultipart(buffer: Buffer, filename = 'customers.xlsx') {
  const boundary = '----CapAgentSmokeBoundary'
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
  )
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    body: Buffer.concat([prefix, buffer, suffix]),
    contentType: `multipart/form-data; boundary=${boundary}`
  }
}

export function assertNoXlsxEsmError(stderr: string) {
  expectNoMatch(stderr, /ERR_UNSUPPORTED_ESM_URL_SCHEME/)
}

function expectNoMatch(text: string, pattern: RegExp) {
  if (pattern.test(text)) {
    throw new Error(`Unexpected module-load error in stderr matching ${pattern}:\n${text.slice(-4000)}`)
  }
}

export function notePreExistingGreen(message: string) {
  // eslint-disable-next-line no-console
  console.info(`[smoke] ${message}`)
}

export function isPortOpen(port: number, host = '127.0.0.1') {
  return new Promise<boolean>((resolvePromise) => {
    const socket = createConnection({ port, host })
    socket.setTimeout(500)
    socket.on('connect', () => {
      socket.destroy()
      resolvePromise(true)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolvePromise(false)
    })
    socket.on('error', () => resolvePromise(false))
  })
}

/** Ask the OS for an unused loopback port instead of guessing a random range. */
export function allocateLoopbackPort() {
  return new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer()
    server.unref()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => {
        if (error) rejectPort(error)
        else if (!port) rejectPort(new Error('OS did not allocate a loopback port'))
        else resolvePort(port)
      })
    })
  })
}

export async function assertPortClosed(port: number) {
  // Retry briefly — Windows may take a moment after taskkill.
  for (let i = 0; i < 20; i++) {
    const open = await isPortOpen(port)
    if (!open && pidsListeningOnPort(port).length === 0) return
    killListenersOnPort(port)
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`Port ${port} is still listening after smoke cleanup (pids=${pidsListeningOnPort(port).join(',')})`)
}

export function localNodeBin() {
  return process.execPath
}

export function localNpmCmd(_cwd: string) {
  if (process.platform === 'win32') return 'npm.cmd'
  return 'npm'
}

export function assertNoNuxtLock(cwd: string) {
  const lockPath = join(cwd, '.nuxt', 'nuxt.lock')
  if (existsSync(lockPath)) {
    throw new Error(`Nuxt lock still present after cleanup: ${lockPath}`)
  }
}
