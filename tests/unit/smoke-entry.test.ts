import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const isWindows = process.platform === 'win32'
const npxCmd = isWindows ? 'npx.cmd' : 'npx'

describe('SMOKE-ENTRY: discoverable Windows Nitro smoke commands', () => {
  it.skipIf(!isWindows)('SMOKE-ENTRY-001: vitest.smoke.config.ts discovers at least two smoke tests', () => {
    const result = spawnSync(
      npxCmd,
      ['vitest', 'list', '--config', 'vitest.smoke.config.ts'],
      { cwd: root, encoding: 'utf8', shell: isWindows }
    )
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    expect(result.status, output).toBe(0)
    expect(output, 'must not report No test files found').not.toMatch(/No test files found/i)

    const lines = output
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => /IMPORT-XLSX|SMOKE-ENTRY|import-xlsx\.smoke/.test(line))
    expect(lines.length, output).toBeGreaterThanOrEqual(2)
  })

  it('SMOKE-ENTRY package script test:smoke is defined and points at smoke config', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['test:smoke']).toMatch(/vitest\.smoke\.config\.ts/)
  })
})
