// 数实际 it() 用例数（不被文件名 / describe 名混淆）
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TESTS = 'D:/by56_CAP_Agent/tests'
let total = 0
const perFile = []

function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const s = statSync(p)
    if (s.isDirectory()) walk(p)
    else if (e.endsWith('.test.ts') || e.endsWith('.smoke.test.ts')) {
      const src = readFileSync(p, 'utf8')
      // 数 it( / it.each( / test( 实际展开后
      let count = 0
      // 处理 it.each([1,2,3])('...', () => {}) 这种
      const eachBlocks = [...src.matchAll(/\b(?:it|test)\.each\(\s*\[([^\]]+)\]/g)]
      for (const m of eachBlocks) {
        const arr = m[1].split(',').filter(x => x.trim())
        count += arr.length
      }
      // 普通 it('name', ...) / it.skip / test
      const singleMatches = [...src.matchAll(/(?:^|\n)\s*(?:it|test)(?:\.skip|\.only)?\(\s*['"`]/g)]
      count += singleMatches.length
      // it.each 每个块内部仍然有 it.each 行（前面的正则匹配了 .each），不算重复
      // 减掉 each 那一行（已被 each 算过）
      const eachLineMatches = [...src.matchAll(/(?:^|\n)\s*(?:it|test)\.each\(\s*\[/g)]
      count -= eachLineMatches.length
      perFile.push({ file: p.replace('D:/by56_CAP_Agent/', ''), count })
      total += count
    }
  }
}
walk(TESTS)
perFile.sort((a, b) => b.count - a.count)
for (const f of perFile) console.log(`${f.count.toString().padStart(4)}  ${f.file}`)
console.log(`TOTAL: ${total}`)
