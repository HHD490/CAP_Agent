// 解析 coverage-final.json，列每个文件未覆盖的 stmt/branch/func 具体行号
// 走绝对路径，避免 cwd 漂移
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const covPath = resolve('D:/by56_CAP_Agent/coverage/coverage-final.json')
const data = JSON.parse(readFileSync(covPath, 'utf8'))

// 路径前缀
const PREFIX = 'D:\\by56_CAP_Agent\\'

// 重点关注 server-side 业务代码 + useDemoState (browser 排除项相关)
// Vue SFC / .nuxt / components / pages / layouts / config / plugins / scripts / shared 全部按 test-scope §4 排除
const INTEREST_DIRS = [
  'server/',
  'utils/',
  'composables/',
]

// 把 statementMap / fnMap / branchMap 展开成行号→映射
function expandMap(statementMap) {
  const out = {}
  for (const [id, range] of Object.entries(statementMap || {})) {
    const start = range.start.line
    const end = range.end.line
    for (let l = start; l <= end; l++) {
      if (!out[l]) out[l] = []
      out[l].push(id)
    }
  }
  return out
}

function branchHitType(counts) {
  if (!Array.isArray(counts) || counts.length === 0) return 'no-branch'
  return counts.map(c => (c > 0 ? '✓' : '✗')).join('|')
}

const results = []
for (const [filePath, fileData] of Object.entries(data)) {
  if (!filePath.startsWith(PREFIX)) continue
  const rel = filePath.slice(PREFIX.length).replace(/\\/g, '/')

  const isInteresting = INTEREST_DIRS.some(d => rel.startsWith(d))
  if (!isInteresting) continue

  const s = fileData.statementMap || {}
  const stmt2line = {}
  for (const [id, range] of Object.entries(s)) {
    const start = range.start.line
    const end = range.end.line
    for (let l = start; l <= end; l++) {
      if (!stmt2line[l]) stmt2line[l] = []
      stmt2line[l].push(id)
    }
  }

  const lineStatus = []
  const sortedLines = Object.keys(stmt2line).map(Number).sort((a, b) => a - b)
  for (const line of sortedLines) {
    const ids = stmt2line[line]
    const allCovered = ids.every(id => (fileData.s[id] || 0) > 0)
    if (!allCovered) lineStatus.push(line)
  }

  // branch
  const b = fileData.branchMap || {}
  const branchUncovered = []
  for (const [id, range] of Object.entries(b)) {
    const counts = fileData.b[id] || []
    const zeroArms = counts.map((c, i) => ({ arm: i, hit: c })).filter(x => x.hit === 0)
    if (zeroArms.length > 0 && zeroArms.length < counts.length) {
      branchUncovered.push({ line: range.loc.start.line, type: range.type, zeroArms, totalArms: counts.length, counts })
    } else if (zeroArms.length === counts.length && counts.length > 0) {
      // 全 0：纯 dead branch
      branchUncovered.push({ line: range.loc.start.line, type: range.type, zeroArms, totalArms: counts.length, counts, allZero: true })
    }
  }

  // fn
  const f = fileData.fnMap || {}
  const fnUncovered = []
  for (const [id, range] of Object.entries(f)) {
    const hits = fileData.f[id] || 0
    if (hits === 0) fnUncovered.push({ line: range.loc.start.line, name: range.name })
  }

  results.push({
    file: rel,
    summary: {
      stmtsPct: fileData.s ? Math.round(Object.values(fileData.s).reduce((a, c) => a + (c > 0 ? 1 : 0), 0) / Object.values(fileData.s).length * 10000) / 100 : 0,
      stmts: `${Object.values(fileData.s).filter(c => c > 0).length}/${Object.values(fileData.s).length}`,
      branchesPct: fileData.b ? Math.round((Object.values(fileData.b).reduce((acc, c) => {
        if (Array.isArray(c)) {
          const any = c.some(x => x > 0)
          return acc + (any ? 1 : 0)
        }
        return acc + (c > 0 ? 1 : 0)
      }, 0) / Object.values(fileData.b).length) * 10000) / 100 : 0,
      branchesHit: `${Object.values(fileData.b).filter(c => Array.isArray(c) ? c.some(x => x > 0) : c > 0).length}/${Object.values(fileData.b).length}`,
      funcsPct: fileData.f ? Math.round(Object.values(fileData.f).reduce((a, c) => a + (c > 0 ? 1 : 0), 0) / Object.values(fileData.f).length * 10000) / 100 : 0,
      funcsHit: `${Object.values(fileData.f).filter(c => c > 0).length}/${Object.values(fileData.f).length}`,
    },
    uncoveredLines: lineStatus,
    branches: branchUncovered,
    fnUncovered,
  })
}

console.log(JSON.stringify(results, null, 2))
