// 解析 coverage-final.json，做 evidence-based 报告
// 关注：1) stmt 全部被覆盖但 branch 部分覆盖（真不变量没锁）2) func 0 覆盖 3) 死分支 vs 真缺
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const covPath = resolve('D:/by56_CAP_Agent/coverage/coverage-final.json')
const data = JSON.parse(readFileSync(covPath, 'utf8'))

const PREFIX = 'D:\\by56_CAP_Agent\\'
const INTEREST_DIRS = ['server/', 'utils/', 'composables/']

// 解析源码（用于看上下文）
import { readFileSync as rfs } from 'node:fs'
function readSrc(rel) {
  try {
    return rfs(resolve(`D:/by56_CAP_Agent/${rel}`), 'utf8').split('\n')
  } catch { return [] }
}

const lines = []
const push = (s) => lines.push(s)
push(`# Coverage Evidence 分析（fresh 跑于 11:28）\n`)
push(`生成时间: ${new Date().toISOString()}\n`)
push(`\n## 0. 总体 (server + utils + composables 业务代码区)\n`)

let totalStmts = 0, totalStmtsHit = 0, totalBranches = 0, totalBranchesHit = 0, totalFuncs = 0, totalFuncsHit = 0
const allFiles = []

for (const [filePath, fileData] of Object.entries(data)) {
  if (!filePath.startsWith(PREFIX)) continue
  const rel = filePath.slice(PREFIX.length).replace(/\\/g, '/')
  if (!INTEREST_DIRS.some(d => rel.startsWith(d))) continue
  allFiles.push({ rel, fileData })
}

for (const { rel, fileData } of allFiles) {
  const s = fileData.s || {}
  const b = fileData.b || {}
  const f = fileData.f || {}
  const stmtHit = Object.values(s).filter(c => c > 0).length
  const stmtTotal = Object.values(s).length
  const branchHit = Object.values(b).filter(c => Array.isArray(c) ? c.some(x => x > 0) : c > 0).length
  const branchTotal = Object.values(b).length
  const funcHit = Object.values(f).filter(c => c > 0).length
  const funcTotal = Object.values(f).length
  totalStmts += stmtTotal; totalStmtsHit += stmtHit
  totalBranches += branchTotal; totalBranchesHit += branchHit
  totalFuncs += funcTotal; totalFuncsHit += funcHit
}

push(`- stmt:  ${totalStmtsHit}/${totalStmts} = ${(totalStmtsHit/totalStmts*100).toFixed(2)}%`)
push(`- branch: ${totalBranchesHit}/${totalBranches} = ${(totalBranchesHit/totalBranches*100).toFixed(2)}%（部分覆盖计 1）`)
push(`- func:  ${totalFuncsHit}/${totalFuncs} = ${(totalFuncsHit/totalFuncs*100).toFixed(2)}%`)
push(`- 文件数: ${allFiles.length}`)

push(`\n## 1. 每个文件 stmt/branch 覆盖\n`)
push(`| 文件 | stmt | branch (部分) | func | 完全没覆盖行 |`)
push(`|---|---:|---:|---:|---|`)
for (const { rel, fileData } of allFiles) {
  const s = fileData.s || {}, b = fileData.b || {}, f = fileData.f || {}
  const stmtHit = Object.values(s).filter(c => c > 0).length
  const stmtTotal = Object.values(s).length
  const branchHit = Object.values(b).filter(c => Array.isArray(c) ? c.some(x => x > 0) : c > 0).length
  const branchTotal = Object.values(b).length
  const funcHit = Object.values(f).filter(c => c > 0).length
  const funcTotal = Object.values(f).length

  // 未覆盖 stmt 行
  const stmt2line = {}
  for (const [id, range] of Object.entries(fileData.statementMap || {})) {
    for (let l = range.start.line; l <= range.end.line; l++) {
      if (!stmt2line[l]) stmt2line[l] = []
      stmt2line[l].push(id)
    }
  }
  const uncoveredLines = []
  for (const [line, ids] of Object.entries(stmt2line)) {
    if (ids.every(id => (fileData.s[id] || 0) === 0)) uncoveredLines.push(Number(line))
  }
  uncoveredLines.sort((a, b) => a - b)

  push(`| \`${rel}\` | ${stmtHit}/${stmtTotal} (${(stmtHit/stmtTotal*100).toFixed(1)}%) | ${branchHit}/${branchTotal} (${(branchHit/branchTotal*100).toFixed(1)}%) | ${funcHit}/${funcTotal} (${funcTotal ? (funcHit/funcTotal*100).toFixed(1) : 'N/A'}%) | ${uncoveredLines.length === 0 ? '✓ 无' : uncoveredLines.join(', ')} |`)
}

push(`\n## 2. 缺一臂的 branch（真"没测到"的分支，区别于死分支 allZero）\n`)
push(`每个 branch 列出：(文件, 行号, 总臂数, 已覆盖臂, 缺臂, 源码上下文)\n`)

for (const { rel, fileData } of allFiles) {
  const b = fileData.branchMap || {}
  const bData = fileData.b || {}
  const partial = []
  for (const [id, range] of Object.entries(b)) {
    const counts = bData[id] || []
    if (!Array.isArray(counts) || counts.length < 2) continue
    const zeroArms = counts.map((c, i) => ({ arm: i, hit: c })).filter(x => x.hit === 0)
    if (zeroArms.length === 0) continue  // 全覆盖
    if (zeroArms.length === counts.length) continue  // 全 0：死分支
    // 至少一臂 hit，至少一臂 0
    const hitArms = counts.map((c, i) => ({ arm: i, hit: c })).filter(x => x.hit > 0)
    partial.push({
      line: range.loc.start.line,
      type: range.type,
      hitArms: hitArms.map(x => `arm${x.arm}=${x.hit}`).join(','),
      zeroArms: zeroArms.map(x => `arm${x.arm}=0`).join(','),
      totalArms: counts.length,
    })
  }
  if (partial.length > 0) {
    push(`\n### ${rel}\n`)
    const src = readSrc(rel)
    for (const p of partial) {
      const ctx = src[p.line - 1] || '(无源码行)'
      push(`- L${p.line} (${p.type}, ${p.totalArms} 臂) 缺: ${p.zeroArms}; 已覆盖: ${p.hitArms}`)
      push(`  \`${ctx.trim().slice(0, 200)}\``)
    }
  }
}

push(`\n## 3. 死分支 allZero（v8 instrument artifact / 防御性 / 不可达）\n`)
push(`这种不是"没测到"，是代码本身在该路径下不可达。列出文件:行号 供对照 test-scope §4 排除项登记。\n`)

for (const { rel, fileData } of allFiles) {
  const b = fileData.branchMap || {}
  const bData = fileData.b || {}
  const dead = []
  for (const [id, range] of Object.entries(b)) {
    const counts = bData[id] || []
    if (!Array.isArray(counts) || counts.length === 0) continue
    if (counts.every(c => c === 0)) {
      dead.push({ line: range.loc.start.line, type: range.type, totalArms: counts.length })
    }
  }
  if (dead.length > 0) {
    push(`- **${rel}**: ${dead.map(d => `L${d.line} (${d.totalArms}臂全0)`).join(', ')}`)
  }
}

push(`\n## 4. 未覆盖 stmt 行（按文件）含源码上下文\n`)
for (const { rel, fileData } of allFiles) {
  const stmt2line = {}
  for (const [id, range] of Object.entries(fileData.statementMap || {})) {
    for (let l = range.start.line; l <= range.end.line; l++) {
      if (!stmt2line[l]) stmt2line[l] = []
      stmt2line[l].push(id)
    }
  }
  const uncovered = []
  for (const [line, ids] of Object.entries(stmt2line)) {
    if (ids.every(id => (fileData.s[id] || 0) === 0)) uncovered.push(Number(line))
  }
  if (uncovered.length === 0) continue
  uncovered.sort((a, b) => a - b)
  const src = readSrc(rel)
  push(`\n### ${rel} (${uncovered.length} 行未覆盖)\n`)
  // 合并连续行
  const groups = []
  let cur = [uncovered[0]]
  for (let i = 1; i < uncovered.length; i++) {
    if (uncovered[i] === cur[cur.length - 1] + 1) cur.push(uncovered[i])
    else { groups.push(cur); cur = [uncovered[i]] }
  }
  groups.push(cur)
  for (const g of groups) {
    if (g.length === 1) {
      push(`- L${g[0]}: \`${(src[g[0]-1] || '').trim().slice(0, 250)}\``)
    } else {
      push(`- L${g[0]}-L${g[g.length-1]}:`)
      for (const l of g) {
        push(`  L${l}: \`${(src[l-1] || '').trim().slice(0, 250)}\``)
      }
    }
  }
}

console.log(lines.join('\n'))
