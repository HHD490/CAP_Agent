// 解析 coverage-final.json，写 UTF-8 文件，避免 stdout 转码问题
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const covPath = resolve('D:/by56_CAP_Agent/coverage/coverage-final.json')
const data = JSON.parse(readFileSync(covPath, 'utf8'))

const PREFIX = 'D:\\by56_CAP_Agent\\'
const INTEREST_DIRS = ['server/', 'utils/', 'composables/']

function readSrc(rel) {
  try {
    return readFileSync(resolve(`D:/by56_CAP_Agent/${rel}`), 'utf8').split('\n')
  } catch { return [] }
}

const lines = []
const push = (s) => lines.push(s)
push(`# Coverage Evidence 分析（fresh 跑于 11:28）`)
push(``)
push(`生成时间: ${new Date().toISOString()}`)
push(``)
push(`## 0. 总体 (server + utils + composables 业务代码区)`)

const allFiles = []
for (const [filePath, fileData] of Object.entries(data)) {
  if (!filePath.startsWith(PREFIX)) continue
  const rel = filePath.slice(PREFIX.length).replace(/\\/g, '/')
  if (!INTEREST_DIRS.some(d => rel.startsWith(d))) continue
  allFiles.push({ rel, fileData })
}

let totalStmts = 0, totalStmtsHit = 0, totalBranches = 0, totalBranchesHit = 0, totalFuncs = 0, totalFuncsHit = 0
for (const { fileData } of allFiles) {
  const s = fileData.s || {}, b = fileData.b || {}, f = fileData.f || {}
  totalStmts += Object.values(s).length
  totalStmtsHit += Object.values(s).filter(c => c > 0).length
  totalBranches += Object.values(b).length
  totalBranchesHit += Object.values(b).filter(c => Array.isArray(c) ? c.some(x => x > 0) : c > 0).length
  totalFuncs += Object.values(f).length
  totalFuncsHit += Object.values(f).filter(c => c > 0).length
}
push(``)
push(`- stmt:  ${totalStmtsHit}/${totalStmts} = ${(totalStmtsHit/totalStmts*100).toFixed(2)}%`)
push(`- branch: ${totalBranchesHit}/${totalBranches} = ${(totalBranchesHit/totalBranches*100).toFixed(2)}%（部分覆盖计 1）`)
push(`- func:  ${totalFuncsHit}/${totalFuncs} = ${(totalFuncsHit/totalFuncs*100).toFixed(2)}%`)
push(`- 文件数: ${allFiles.length}`)

push(``)
push(`## 1. 每个文件 stmt/branch 覆盖`)
push(``)
push(`| 文件 | stmt | branch (部分) | func | 未覆盖行 |`)
push(`|---|---:|---:|---:|---|`)
for (const { rel, fileData } of allFiles) {
  const s = fileData.s || {}, b = fileData.b || {}, f = fileData.f || {}
  const stmtHit = Object.values(s).filter(c => c > 0).length
  const stmtTotal = Object.values(s).length
  const branchHit = Object.values(b).filter(c => Array.isArray(c) ? c.some(x => x > 0) : c > 0).length
  const branchTotal = Object.values(b).length
  const funcHit = Object.values(f).filter(c => c > 0).length
  const funcTotal = Object.values(f).length

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
  const pct = (stmtHit/stmtTotal*100).toFixed(1)
  const bpct = (branchHit/branchTotal*100).toFixed(1)
  const fpct = funcTotal ? (funcHit/funcTotal*100).toFixed(1) : 'N/A'
  push(`| \`${rel}\` | ${stmtHit}/${stmtTotal} (${pct}%) | ${branchHit}/${branchTotal} (${bpct}%) | ${funcHit}/${funcTotal} (${fpct}%) | ${uncoveredLines.length === 0 ? '✓ 无' : uncoveredLines.join(', ')} |`)
}

push(``)
push(`## 2. 缺一臂的 branch（真"没测到"的分支）`)
push(``)
push(`每个 branch 列出：(文件, 行号, 总臂数, 缺臂, 源码上下文)`)
let hasPartial = false
for (const { rel, fileData } of allFiles) {
  const b = fileData.branchMap || {}
  const bData = fileData.b || {}
  const partial = []
  for (const [id, range] of Object.entries(b)) {
    const counts = bData[id] || []
    if (!Array.isArray(counts) || counts.length < 2) continue
    const zeroArms = counts.map((c, i) => ({ arm: i, hit: c })).filter(x => x.hit === 0)
    if (zeroArms.length === 0) continue
    if (zeroArms.length === counts.length) continue
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
    hasPartial = true
    push(``)
    push(`### ${rel}`)
    const src = readSrc(rel)
    for (const p of partial) {
      const ctx = src[p.line - 1] || '(无源码行)'
      push(`- L${p.line} (${p.type}, ${p.totalArms} 臂) 缺: ${p.zeroArms}; 已覆盖: ${p.hitArms}`)
      push(`  \`${ctx.trim().slice(0, 200)}\``)
    }
  }
}
if (!hasPartial) push(`（无）`)

push(``)
push(`## 3. 死分支 allZero（v8 instrument artifact / 防御性 / 不可达）`)
push(``)
push(`这种不是"没测到"，是代码本身在该路径下不可达。列出文件:行号 供对照 test-scope §4 排除项登记。`)
push(``)
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

push(``)
push(`## 4. 未覆盖 stmt 行（按文件）含源码上下文`)
push(``)
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
  push(``)
  push(`### ${rel} (${uncovered.length} 行未覆盖)`)
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

const out = lines.join('\n')
writeFileSync(resolve('D:/by56_CAP_Agent/.tmp_wharttest/coverage-report.md'), out, 'utf8')
console.log(`Wrote ${out.length} bytes to .tmp_wharttest/coverage-report.md`)
console.log(`Partial-branch sections: ${hasPartial ? 'YES' : 'NO'}`)
