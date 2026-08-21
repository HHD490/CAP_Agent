// 读 coverage-final.json，列 server/utils/agent.ts 真正未覆盖行
const fs = require('node:fs');
const path = require('node:path');

const covPath = path.join('D:/by56_CAP_Agent', 'coverage', 'coverage-final.json');
const data = JSON.parse(fs.readFileSync(covPath, 'utf8'));

// 找所有 server/utils/agent* 的 key
const keys = Object.keys(data).filter(k => k.includes('server') && k.includes('agent'));
console.log('matched keys:');
for (const k of keys) console.log('  ' + k);

for (const k of keys) {
  const a = data[k];
  if (!a) continue;
  const sm = a.statementMap || {};
  const fnMap = a.fnMap || {};
  const branchMap = a.branchMap || {};
  const sCov = a.s || {};
  const fCov = a.f || {};
  const bCov = a.b || {};

  const totalStmts = Object.keys(sm).length;
  const coveredStmts = Object.values(sCov).filter(v => v > 0).length;
  const totalFns = Object.keys(fnMap).length;
  const coveredFns = Object.values(fCov).filter(v => v > 0).length;
  const totalBranches = Object.values(branchMap).reduce((acc, b) => acc + (b.locations ? b.locations.length : 0), 0);
  const coveredBranches = Object.values(bCov).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.filter(v => v > 0).length : 0), 0);

  console.log('\n=== ' + path.basename(k) + ' ===');
  console.log('stmts: ' + coveredStmts + '/' + totalStmts);
  console.log('funcs: ' + coveredFns + '/' + totalFns);
  console.log('branches: ' + coveredBranches + '/' + totalBranches);

  // 列未覆盖 stmt 行号
  const uncoveredStmts = Object.entries(sCov)
    .filter(([_, v]) => v === 0)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
  if (uncoveredStmts.length > 0) {
    console.log('\n  uncovered statements:');
    for (const idx of uncoveredStmts) {
      const m = sm[idx];
      if (m) console.log('    L' + m.start.line + ':' + m.start.column + '  (' + (m.end.line - m.start.line) + ' lines)');
    }
  }

  // 列未覆盖 func
  const uncoveredFns = Object.entries(fCov)
    .filter(([_, v]) => v === 0)
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
  if (uncoveredFns.length > 0) {
    console.log('\n  uncovered functions:');
    for (const idx of uncoveredFns) {
      const m = fnMap[idx];
      if (m) console.log('    ' + m.name + ' @ L' + m.decl.start.line);
    }
  }

  // 列未覆盖 branch
  const uncoveredBranches = [];
  for (const [bidx, arr] of Object.entries(bCov)) {
    if (!Array.isArray(arr)) continue;
    arr.forEach((v, i) => {
      if (v === 0) {
        const b = branchMap[bidx];
        if (b && b.locations && b.locations[i]) {
          uncoveredBranches.push({ line: b.locations[i].start.line, type: b.type, branchIndex: i });
        }
      }
    });
  }
  uncoveredBranches.sort((a, b) => a.line - b.line);
  if (uncoveredBranches.length > 0) {
    console.log('\n  uncovered branches:');
    for (const b of uncoveredBranches) {
      console.log('    L' + b.line + ' (' + b.type + ' #' + b.branchIndex + ')');
    }
  }
}
