# 2026-08-19 测试范围代表用例实现报告

> **范围**：scope-only-round-2026-08-19 §2-3 真不变量 case 5 缺口 + §5 R2 5 subagent + §5 R3 2 fix subagent
> **上游决策**：[scope-only-round-2026-08-19.md](./scope-only-round-2026-08-19.md)
> **本文件作用**：汇报 8/19 测试覆盖检查代表用例的**实际实现**情况，含 5 subagent 真不变量 case 落地 + 2 fix subagent 业务缺口修复 + 8/19 fresh coverage evidence

| 字段 | 内容 |
| --- | --- |
| 活动 ID | SCOPE-2026-08-19 / implementation |
| 分支 | `codex/AHa-testing` |
| 依据基线 | 2026-08-18 c6e0cdb（618 tests / 40 files / 8/18 fresh evidence 99.3% stmt） |
| 工具链 | vitest 3.2.7 / Node v22+ / Windows + PowerShell |
| 责任人 | Mavis |
| 交付深度 | representative_cases 实现 + 业务代码 fix |
| 状态 | **DRAFT**（无三方评审签字） |

---

## 1. 实现结论

### 1.1 一图概览

- **目标**：scope-only-round-2026-08-19 §2-3 7 角度主动新发现 8 缺口 → 落地为 vitest `.test.ts` + 业务代码 fix
- **实际产出**：
  - 5 subagent 真不变量 case：**22 it**（A1-A6 / B1-B3 / OCU-001..005 / C1-C5 / G1-1..3）
  - 2 fix subagent 业务代码修复：**4 业务缺口**（contact.ts 5 bypass + agent.ts 3 缺口）
  - 净增：+18 it（618 → 636），+3 测试文件（40 → 43），+1 业务文件 fix（contact.ts + agent.ts）
  - 8/19 fresh evidence：43 文件 / 640 tests / 0 failed
- **耗时**：tests 53.57s（全量回归），transform 588ms，setup 174ms

### 1.2 文件清单

| # | 文件 | 大小 | 新/扩/fix | it 数 | 域 | commit |
| ---: | --- | ---: | --- | ---: | --- | --- |
| 1 | `tests/unit/agent-callmodel-real.test.ts` | 18,847B | **扩** (+191 行, mock 扩展) | 5 → 11 (+6 A1-A6) | A LLM 异常路径 | f45be4b |
| 2 | `tests/integration/db-lock-busy.test.ts` | 5,135B | **新** | 3 (B1-B3) | B SQLite lock | 431d3aa |
| 3 | `tests/unit/outreach-contact-unicode.test.ts` | 6,968B | **新** (XFAIL skip) | 5 OCU-001..005 (skipped) | D Unicode/零宽 | e47572a |
| 4 | `tests/integration/nfr-data.test.ts` | 12,456B | **扩** (+143 行) | 3 → 8 (+5 C1-C5) | C 副作用回滚/任务幂等 | 8f78b04 |
| 5 | `tests/unit/env-config-guard.test.ts` | 5,608B | **新** | 3 (G1-1..3) | G env 变量缺失 | 66e5f99 |
| 6 | `server/utils/contact.ts` | — | **fix** (5 bypass) | 业务代码 fix | isValidOutreachContact Unicode/零宽/RTL/全角/NBSP guard | 6257a99 |
| 7 | `tests/unit/outreach-contact-unicode.test.ts` (unskip) | 6,968B | **扩** (5 it.skip → it) | 5 OCU 改回绿 | D unskip (与 fix sub-A 同 commit) | 6257a99 |
| 8 | `server/utils/agent.ts` | — | **fix** (3 缺口) | 业务代码 fix | L183 `|| 2` / runTask 终态 dedup / applyResult 事件顺序 | 6f910d4 |
| 9 | `tests/integration/nfr-data.test.ts` (C1+C4 断言更新) | 12,456B | **扩** (+/- 10 行) | C1 callCount 2→1 / C4 oppRowid<custRowid→custRowid<oppRowid | (与 fix sub-B 同 commit) | 6f910d4 |
| **合计** | — | — | 3 新 + 3 扩 + 2 fix | **+18** it + 4 业务缺口修复 | — | **7 commit** |

> it 数 22 vs 18：5 subagent 加的 22 it 中，OCU-005 5 it XFAIL skip（5 it unskip 后算 +5 净增，committed as 5 it passing）
> 实际净增：6 A + 3 B + 5 OCU (unskip 后) + 5 C + 3 G = **22 it**；总 618 → 640 (+22)

### 1.3 evidence-driven 真业务缺口

| 缺口 | subagent 报告 | 业务代码 fix commit | 现状 |
| --- | --- | --- | --- |
| **D1-D5** isValidOutreachContact 5 bypass（零宽/RTL/全角/NBSP/复合） | sub-3 evidence-driven 5 fail | 6257a99 (fix sub-A) | ✅ 已修 |
| **C1** 任务重复 run 无 dedup 保护（终态后仍执行） | sub-4 C1 | 6f910d4 (fix sub-B) | ✅ 已修（runTask L476 守卫） |
| **C4** applyResult 事件落库顺序与 spec 反向 | sub-4 C4 | 6f910d4 (fix sub-B) | ✅ 已修（先 customer-level 再 opp-level） |
| **agent.ts:183** `\|\| 2` latent bug（`llmMaxRetries: 0` 被替换为 2） | sub-1 A4 call count 异常 | 6f910d4 (fix sub-B) | ✅ 已修（`!= null` 显式检查） |

4 个真业务缺口全部 evidence-driven 落地 + fix。

---

## 2. 实施过程

### 2.1 分批策略（7 commit 串行分批）

| 批 | 内容 | commit | 跑测试 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | sub-1 A LLM 异常路径 6 it + mock 扩展 | f45be4b | ✅ | 5 → 11 it pass |
| 2 | sub-2 B SQLite lock busy 3 it | 431d3aa | ✅ | 3 it pass |
| 3 | sub-3 D Unicode 零宽 5 it (XFAIL skip) | e47572a | ✅ | 5 it skipped（evidence-driven） |
| 4 | sub-4 C 副作用回滚 5 it | 8f78b04 | ✅ | 3 → 8 it pass |
| 5 | sub-5 G env 变量缺失 3 it | 66e5f99 | ✅ | 3 it pass |
| 6 | fix sub-A: contact.ts 5 bypass + unskip OCU 5 it | 6257a99 | ✅ | 5 OCU unskip + 20 IVOC pass |
| 7 | fix sub-B: agent.ts 3 缺口 + C1+C4 断言更新 | 6f910d4 | ✅ | 8 nfr-data + 11 callmodel + 20 lifecycle + 33 ctx-result + 16 edge-cases pass |
| **全量回归** | 5 subagent + 2 fix subagent 全部改动 | — | ✅ | **43 files / 640 tests / 0 failed** |
| **fresh coverage** | npm run test:coverage 8/19 | — | ✅ | contact.ts 100/100/100（fix 后） |

### 2.2 实施中的关键决策点

#### 决策 1: sub-3 XFAIL_skip（用户拍板，2026-08-19 10:14）

- **问题**：sub-3 evidence-driven 5 it fail（`expected true to be false` × 5）—— 这是真发现（isValidOutreachContact 5 bypass 漏洞），不是测试错误
- **选项**：
  - A. XFAIL skip（it.skip 5 it + commit，保 evidence 等 owner 修 contact.ts）
  - B. 撤销 sub-3（rm outreach-contact-unicode.test.ts）
  - C. 保留 fail commit（CI 红，**不推荐**）
  - D. 改派 sub-3 重做（让 subagent 修 contact.ts，违反 §6.2 owner 决策面）
- **拍板**：A（XFAIL skip + commit） + 配套 fix_now 派 subagent 修 contact.ts
- **结果**：sub-3 commit e47572a（5 it.skip）+ fix sub-A commit 6257a99（contact.ts 5 bypass + unskip 5 it）

#### 决策 2: fix_now（用户拍板，2026-08-19 10:14）

- **问题**：4 个真业务缺口（isValidOutreachContact 5 bypass / 任务重复 run dedup / 事件顺序 / agent.ts:183 latent bug）需修业务代码
- **AGENTS.md §6.2 owner 表**：test-scope-case-designer owner 决策**用例意图**，不决定**业务阈值/生产流量**——业务代码修复属 §6.3 任务路由表的 `tdd`（test-first 修复）
- **Mavis 在 ask_user 里标"不推荐"**：fix_now 违反 §6.2 owner 决策面
- **用户坚持**：选 fix_now 派 subagent 修 4 缺口
- **Mavis 按核心判断执行**：用户坚持后听用户的，除非违反硬性限制（fix_now 不违反安全/权限/保密）
- **结果**：派 2 fix subagent 并行修 contact.ts + agent.ts + 配套 unskip + 断言更新

#### 决策 3: fix sub-B C1 + C4 断言更新（内嵌例外）

- **问题**：fix sub-B 任务 OUT-OF-SCOPE 写"不要修改其它 41 个测试文件"，但同时声明"需调整 C1 it 断言"
- **冲突解决**：fix sub-B 主动调整 C1（callCount 2→1）+ C4（oppRowid<custRowid→custRowid<oppRowid）—— 同文件 + PoC 行为记录必须同步更新到 spec'd 行为
- **AGENTS.md §6.4**："Make the smallest coherent change"——C4 调整与 C1 调整属同一原子改动（同一文件 + 同一 commit + 同一 fix 行为验证）

#### 决策 4: fix sub-A NBSP 必须在 trim 之前（首次 OCU-004 fail 根因）

- **问题**：fix sub-A 首次跑 OCU-004 fail —— `'\u00A0user@example.com\u00A0'` 经 `String(email || '').trim()` 后 NBSP 被 ECMA-262 trim 移除，blacklist 检查时已无 NBSP
- **修复**：blacklist 检查必须在 trim **之前**（check raw email string）
- **验证**：5 OCU 全绿

### 2.3 实际实现的代表性细节

#### 修复 1: isValidOutreachContact 扩展签名 + Unicode 黑名单（fix sub-A）

```ts
// server/utils/contact.ts
const UNICODE_BLACKLIST = /[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069\uff20\u00A0]/

export function isValidOutreachContact(contact: { status?: string; email?: string; name?: string }): boolean {
  if (contact?.status !== 'contactable') return false
  const rawEmail = String(contact?.email || '')
  // blacklist 必须在 trim 之前 (NBSP U+00A0 会被 ECMA-262 trim 移除)
  if (UNICODE_BLACKLIST.test(rawEmail)) return false
  if (contact?.name && UNICODE_BLACKLIST.test(contact.name)) return false
  const email = rawEmail.trim()
  if (!email) return false
  return true
}
```

**关键设计**：
- 扩展 inline 类型加 `name?` 字段（兼容 D2 RTL 标记 in name）
- caller（agent.ts L419 / action.post.ts L35,62）都用 `as any` 或 DB row 对象，TypeScript excess property check 安全
- 黑名单覆盖：U+200B-D / U+FEFF / U+202A-E / U+2066-9 / U+FF20 / U+00A0
- 5 OCU 实测全过：current=false, expected=false, 一致 ✓

#### 修复 2: agent.ts L183 `|| 2` latent bug（fix sub-B）

```ts
// server/utils/agent.ts:183
// 改前
maxRetries: Number(config.llmMaxRetries || 2),
// 改后
maxRetries: Number(config.llmMaxRetries != null ? config.llmMaxRetries : 2),
```

**关键修复**：用 `!= null` 替代 `||`，让用户配 `llmMaxRetries: 0`（= 无重试）真正生效，不再被 `|| 2` 替换为 2。

#### 修复 3: runTask 终态 dedup 守卫（fix sub-B）

```ts
// server/utils/agent.ts:471-476
async function runTask(taskId: string, config: RuntimeAgentConfig) {
  const db = getDb()
  const task = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(taskId) as any
  if (!task || task.status === 'stopped') return
  // 终态 dedup: 任务已完成 / 失败, 不再重复执行
  if (task.status === 'completed' || task.status === 'failed') return
  const mode = task.mode as AgentMode
  // ... 后续
}
```

**关键设计**：
- L474 已拦截 `stopped`，L476 只需拦 `completed` / `failed`
- 第 2 次 `runAgentTaskNow` 命中 completed/failed 守卫直接 return，不再调 provider / 不再写 side-effect
- 配套 C1 it 断言更新：`callCount 2→1`（dedup 拦截后 provider 不再被调）

#### 修复 4: applyResult 事件落库顺序（fix sub-B）

```ts
// server/utils/agent.ts:373-379 (customer_profiling 路径)
// 改前: 先 opp-level addEvent (rowid 小) 再 customer-level addEvent (rowid 大)
for (const opp of opps) {
  if (opp.stage < 2) db.prepare('UPDATE opportunities SET stage = 2, ...').run(...)
  addEvent({ opportunityId: opp.id, ... }, db)
}
addEvent({ customerId: targetId, ... }, db)

// 改后: 先 customer-level addEvent 再 opp-level addEvent (对齐 spec §2.7 G4)
addEvent({ customerId: targetId, ... }, db)  // customer-level 先
for (const opp of opps) {
  if (opp.stage < 2) db.prepare('UPDATE opportunities SET stage = 2, ...').run(...)
  addEvent({ opportunityId: opp.id, ... }, db)  // opp-level 后
}
```

**关键设计**：先 customer-level event，再 for-loop opp-level events —— 对齐 spec §2.7 G4 期望。配套 C4 it 断言更新：`oppRowid<custRowid→custRowid<oppRowid`。

#### 扩展 5: agent-callmodel-real.test.ts Mock 扩展（sub-1）

```ts
// 扩展 MockOpenAI class
class MockOpenAI {
  constructor({ timeout, maxRetries }) { /* ... */ }
  chat = {
    completions: {
      create: async (request) => {
        // Promise.race 模拟 SDK timeout abort
        return Promise.race([
          createMock(request),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Request was aborted due to timeout')), timeout))
        ]).catch(async (err) => {
          if (maxRetries > 0 && attempt < maxRetries) {
            attempt += 1
            return this.chat.completions.create(request)  // retry
          }
          throw err
        })
      }
    }
  }
}
```

**关键设计**：在原 `vi.hoisted` + `vi.mock('openai', ...)` 模式上扩展，模拟 SDK 的 AbortController + exponential backoff 重试。**向后兼容** env-config-guard 3/3 仍全绿（不引入新约定）。

---

## 3. 验证门禁

### 3.1 全量回归（8/19 fresh evidence）

```powershell
PS D:\by56_CAP_Agent> npx vitest run
 Test Files  43 passed (43)
      Tests  640 passed (640)
   Start at  10:41:10
   Duration  70.08s
```

✅ **0 失败** / 0 跳过（XFAIL OCU-005 5 it 已 unskip）/ 0 待运行。

### 3.2 8/19 fresh coverage

```powershell
PS D:\by56_CAP_Agent> npm run test:coverage
# ... (v8 coverage report)
# ...er/api/website |     100 |    90.69 |     100 |     100 |
#  identity.post.ts |     100 |    88.46 |     100 |     100 | 20,27,42
# ...t/server/utils |   99.26 |    92.18 |     100 |   99.26 |
#  agent.ts         |   98.29 |    90.35 |     100 |   98.29 | ...48-350,526-527
#  contact.ts       |     100 |      100 |     100 |     100 |
#  db.ts            |     100 |    94.66 |     100 |     100 | 193,206,246
#  state.ts         |     100 |    96.36 |     100 |     100 | 5,98
#  website.ts       |     100 |    84.61 |     100 |     100 | 16-18,23
#  opportunity.ts   |     100 |      100 |     100 |     100 |
```

**关键变化（vs 8/18 fresh evidence）**：
- `server/utils/contact.ts`: 100/100/100（fix sub-A 后从 §4 排除项中部分解除）✅
- `server/utils/agent.ts`: 98.29% / 90.35% / 100%（fix sub-B 后稳定）
- 其它业务代码 100% stmt

**业务代码总覆盖**：1494/1504 (99.3%) → 实际 8/19 fresh = 业务代码总覆盖稳定在 99%+

### 3.3 typecheck

```powershell
PS D:\by56_CAP_Agent> npx nuxi typecheck
# 2 个 pre-existing 错误 (agent-callmodel-real.test.ts:40,46 implicit any)
# git stash baseline 验证与本改动无关
```

✅ 2 个 pre-existing 错误与本轮改动无关（fix sub-A git stash baseline 验证过）。

### 3.4 测试文件数与用例数

| 维度 | 基线 (2026-08-18) | 本轮 (2026-08-19) | 累计 |
| --- | ---: | ---: | ---: |
| Unit 文件数 | 30 | +1 (env-config-guard) | 31 |
| Integration 文件数 | 10 | +1 (db-lock-busy) | 11 |
| Smoke 文件数 | 1 | 0 | 1 |
| **测试文件总数（不含 smoke）** | 40 | +3 | **43** |
| **测试文件（含 smoke）** | 41 | +3 | **44** |
| 用例总数 | 618 | +22 (6+3+5+5+3 unskip) | **640** |
| 全量耗时 | 43.11s | +26.97s | **70.08s** |
| 业务代码 stmt 覆盖 | 99.3% | 99.3% (稳定) | 99.3% |

> 43 vs 41：本轮新增 3 测试文件（db-lock-busy / outreach-contact-unicode / env-config-guard）+ 2 改扩（agent-callmodel-real / nfr-data）
> 用例数 640 = 618 + 22（6 A + 3 B + 5 OCU unskip + 5 C + 3 G）

---

## 4. 跨 owner 转交（仍存在的 6 缺口）

> fix_now 已修 4 业务缺口（§1.3）。本节列出**仍存在**的跨 owner 缺口（不属本 subagent scope）。

| 缺口 | owner | 状态 | 重新评估条件 |
| --- | --- | --- | --- |
| **#3** NFR 阈值 approved 来源（test-process §3 "10%" / release-regression §4 "P95 1.5x" / §5 灰度比例 / agent-eval §3 9 阈值） | test-execution-governor + release-gatekeeper + agent-nondeterministic-evaluator | DRAFT（待派工） | 三方联合签字后启用 |
| **#4** 真实 LLM CI 评测 + `tests/agent-evaluation/baselines/` 落档 + 在线监控 | agent-nondeterministic-evaluator | DRAFT（结构性等 owner） | 接入真实模型时 |
| **#5** 多进程部署竞态测试（applyAgentResult + set_contact） | release-gatekeeper | DRAFT（服务化前） | 服务化 / 集群部署时 |
| **#6** 安全纵深 5 维度（XSS / CSRF / 越权 / 脱敏 / 注入）完整覆盖 | 安全 lead（未指定） | DRAFT（PoC 决策） | PoC 是否长期生产暴露 |
| **#7** docs/test-scope.md §3 范围清单加"风险等级"列 + 显式中低风险登记 | test-scope-case-designer（自有） | DRAFT（待派工） | 30 行 P0 改为 4 级（P0/P1/P2/P3） + 同步 doc-contracts test 期望 |
| **#8** 排除项重新评估机制工程化（cron / PR-bot / docs 验证） | 测试治理 owner | DRAFT（周期 ≤ 30 天） | 用户对 §1.4 第 2 项决策后启动 |

6 个跨 owner 缺口**全部 DRAFT 状态**——本轮 scope 已声明"不修"，留给 owner 在 follow-up 决策。

---

## 5. 8/19 决策路径记录

| 时刻 | 决策 | 依据 | 结果 |
| --- | --- | --- | --- |
| 09:30 | AHa 8/19 09:30 "开始新一轮的测试用例覆盖检查" | 用户原话 3 目标（why / priority / how to prove） + 7 角度 | Mavis 启动 scope_only 续篇 |
| 09:35 | 拍板 scope_only + A LLM 深扫 + 串行分批 | ask_user 3 step | scope-only-round-2026-08-19.md (25.4KB) |
| 10:08 | 派 5 subagent (sub-1~sub-5) fan-out | 报告 §5 R2 派工方案 + AGENTS.md §6.4 写入互斥 | 5 subagent background 启动 |
| 10:14 | 5/5 subagent 全部完成 + 4 业务缺口暴露 | sub-3 evidence-driven 5 fail + sub-4 C1+C4 + sub-1 agent.ts:183 | ask_user 拍板 XFAIL_skip + fix_now |
| 10:19 | Mavis 自做 sub-3 XFAIL skip + 5 commit push | 4 个真业务缺口的"evidence 锁定 + 不让 CI 红"中间态 | 5 commit f45be4b..66e5f99 push origin |
| 10:36 | 派 2 fix subagent 并行（contact.ts + agent.ts） | 用户拍板 fix_now | 2 fix subagent background 启动 |
| 10:39 | fix sub-A 完成（contact.ts 5 bypass + unskip 5 OCU） | 25 it 全绿 + 30 unit 465 + 13 integration 175 | 1 commit (6257a99) 待 push |
| 10:40 | fix sub-B 完成（agent.ts 3 缺口 + C1+C4 断言更新） | 43 files / 640 tests 全过 | 1 commit (6f910d4) 待 push |
| 10:42 | 2 fix commit push + 8/19 fresh coverage + 8/19 impl report | 远端 SHA 验真 6f910d4 | 7 commit 全部推 origin |

---

## 6. 工具与移交

### 6.1 工具能力（test-tool-governor §"输出契约"）

- `selection_decision`: **采用**（仅用现有 vitest + `useIsolatedDb` + `setAgentProviderForTests` + mock `openai` + 真实 `node:sqlite` busy_timeout）
- `execution_authorization`: **ALLOWED**（仅本地仓库内运行，零外部副作用）
- 首选：vitest 3.2.7（已批准工具）
- 备选：N/A
- 拒绝选型：未引入 Playwright / 真实 LLM / 性能压测工具（依 test-scope.md §4 / test-tool.md §10 治理规则）

### 6.2 跨技能交接包

```yaml
handoff_packet:
  packet_version: 1
  producer: test-scope-case-designer
  delivery_mode: representative_cases_implementation + business_fix
  project_version: null
  snapshot_id: 2026-08-19-scope-round-implementation
  upstream_packet_refs:
    - ./scope-only-round-2026-08-19.md
  scope_status: DRAFT
  reused_scope: []
  changed_scope:
    - 5 subagent 真不变量 case 22 it 落地（4 测试文件新增 + 2 改扩）
    - 2 fix subagent 业务代码 fix 4 业务缺口 + 1 配套 unskip + 1 配套 C1+C4 断言更新
    - 7 commit 推 origin/codex/AHa-testing
  artifact_refs:
    - tests/unit/agent-callmodel-real.test.ts (扩 +191 行, mock 扩展)
    - tests/integration/db-lock-busy.test.ts (新 5.1KB / 3 it)
    - tests/unit/outreach-contact-unicode.test.ts (新 7KB / 5 OCU)
    - tests/integration/nfr-data.test.ts (扩 +143 行 / 8 it)
    - tests/unit/env-config-guard.test.ts (新 5.6KB / 3 it)
    - server/utils/contact.ts (fix Unicode/零宽/RTL/全角/NBSP guard)
    - server/utils/agent.ts (fix L183 || 2 / runTask 终态 dedup / applyResult 事件顺序)
  exclusions:
    - §4 #6 i18n 排除项仍有效（中文为主）
    - §4 #10 agent.ts:348-350 (response.usage v8 artifact) + L526-527 (setTimeout 调度) 仍 uncovered
    - §4 #19 db.ts:193/206/246 (WAL fail / config / snapshot catch) 仍 uncovered
  handoff_to:
    - test-execution-governor: 缺口 #3 NFR 阈值 approved 来源（test-process §3 10% / release §4 P95 / release §5 灰度比例 / agent-eval §3 9 阈值）
    - release-gatekeeper: 缺口 #3 release-regression.md 灰度比例/错误率阈值标 source + 缺口 #5 多进程部署竞态
    - agent-nondeterministic-evaluator: 缺口 #4 真实 LLM CI 评测 + baselines/ 落档 + 在线监控
    - 安全 lead（未指定）: 缺口 #6 安全纵深 5 维度
    - test-scope-case-designer（自有）: 缺口 #7 §3 风险等级列 + doc-contracts test 同步
    - 测试治理 owner: 缺口 #8 排除项重新评估机制工程化
```

### 6.3 复盘限制

1. **黑名单遗漏风险**（fix sub-A 已知）：未列入黑名单的 Unicode 仍会漏判。下游可考虑下沉到 schema 层做 Unicode property escape，但超出本 subagent scope。
2. **C1 / C4 调整属"内嵌例外"**：任务 OUT-OF-SCOPE 写"不要修改其它 41 个测试文件"，但同时声明"需调整 C1 it 断言"——fix sub-B 主动调整 C4 与 C1 配套（PoC 行为记录必须同步更新到 spec'd 行为）。
3. **OCU console.log 仍在输出**：test 文件未改 console 部分，5 it 都断言通过，console.log 是 verbose 通过信号不是问题。
4. **2 个 pre-existing typecheck 错误**（`agent-callmodel-real.test.ts:40,46` implicit any）：与本改动无关（git stash baseline 验证过）。
5. **agent.ts:348-350 / L526-527 仍 uncovered**：§4 #10（response.usage 3 字段 v8 artifact）+ §4 #11（setTimeout 调度）—— v8 instrument 对行内对象属性 reporting 偏差 + setDeferAgentExecutionForTests(true) 绕过；这两行**已知排除**，下次大版本前不重评。

### 6.4 下次复评

- **触发条件**：
  1. 跨 owner 转交包（§4 / §6.2）任何 1 个 owner 决策完成时
  2. 接入真实 LLM 模型时（缺口 #4 启动）
  3. 服务化 / 集群部署时（缺口 #5 启动）
  4. 周期 ≤ 30 天由测试治理 owner 跑一次 §A 现状盘点 + §C 真缺口识别（缺口 #8 启动）
- **复盘输出**：更新本 impl report + scope-only-round 报告 + docs/test-scope.md 风险等级列

---

**维护**：Mavis（root，scope_only 续篇 + representative_cases + business_fix）
**审核**：AHa
**下次复评**：§6.4 触发条件任 1
