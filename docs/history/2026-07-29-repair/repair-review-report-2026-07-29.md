# CAP Agent 测试修复工作汇报（供审核）

| 字段 | 内容 |
|---|---|
| 报告日期 | 2026-07-29 |
| 工作分支 | `codex/AHa-testing` |
| 问题核对基线 | `65e213a64941131e7b2353dafb7ffb93fc762371`（GitHub `main` 原始提交） |
| 规格依据 | `docs/test-repair-spec.md` |
| 执行方式 | 严格 TDD：每项先 Red（失败测试）→ 最小 Green → 回归 |
| 提交状态 | **未提交、未推送、未创建 PR** |
| 运行时 | Node `v24.18.0` / npm `12.0.1` / Vitest `3.2.7` / Windows 10 |

---

## 1. 审核目标与范围

本轮按规格第 4–6 节与第 8 节提示词，修复并验证六项缺陷。审核模型应重点核对：

1. 是否严格遵守 TDD（有 Red 证据，未用跳过/放宽断言规避）。
2. 生产修改是否为“最小必要”，是否引入无关重构。
3. 是否误改用户已有工作区内容（见第 2 节）。
4. 六组测试 ID 是否齐全，负向路径是否覆盖。
5. `IMPORT-XLSX` 标为 pre-existing green 是否成立。
6. 规格中的业务决策点是否被擅自拍板。

**明确不做：** 不升级 `xlsx`/`nuxt`/`vitest`；不写入演示库 `data/*.sqlite`；不调用真实 LLM；不修改官网 identity 的用户输入 `customerType` 契约。

---

## 2. 工作区约束遵守情况

开始前记录的已有改动（规格要求保留）：

| 路径 | 本轮是否改动业务语义 | 说明 |
|---|---|---|
| `.env.example` | 否 | 仍为用户既有改动（多为行尾） |
| `nuxt.config.ts` | 否 | 同上 |
| `server/utils/db.ts` | **是（授权修复）** | 增加测试 seam、修正产品 seed `published`、抽取 stale 策略 |
| `CAP_Agent_问题定位报告_2026-07-28.html` | 否 | 未跟踪文件，未覆盖 |
| `docs/test-repair-spec.md` | 否 | 规格文档本身 |

未使用 `git reset --hard` / 破坏性 checkout / 删除演示数据库。

---

## 3. 测试基础设施（新建）

| 路径 | 职责 |
|---|---|
| `vitest.config.ts` | Vitest；默认跑 `tests/unit` + `tests/integration`；smoke 需显式指定 |
| `tests/helpers/setup.ts` | Nitro/Nuxt 自动导入 shim（`useRuntimeConfig` 等） |
| `tests/helpers/db.ts` | 临时 SQLite 隔离夹具；测试结束清理 |
| `tests/helpers/nitro-smoke.ts` | Windows Nitro 进程启停、multipart、xlsx buffer |
| `server/utils/db.ts` | `setDbForTests` / `initializeDatabaseConnection` / `markNonAcceptedMatchesStale` |
| `server/utils/agent.ts` | Provider mock、延迟执行、`runAgentTaskNow`、schema/context/apply 测试导出 |

原则：隔离临时库、固定 demo clock、mock Provider、不断言私有 SQL 字符串。

---

## 4. 六项问题逐条汇报

### 4.1 PRODUCT-PUBLISH（BY004 不得视为已发布）

**根因（代码证据）：** `seedProducts` INSERT 将 `published` 硬编码为 `1`，PMS 快照硬编码 `published: true`；元组末字段被当作 `simulated`。

**Red：** `PRODUCT-PUBLISH-001/002/003` 均失败
- 001：`published` 期望 0 实得 1
- 002：匹配上下文含 `BY004`
- 003：`match_results` 写入 BY004

**Green（最小修复）：**
- seed 每行显式携带 `published`；BY004 = `false`；快照使用同一布尔值。
- `applyResult(product_matching)`：先解析已发布候选；若为零则抛错，不写 `matching_completed`、不推进 stage。
- `targetContext` 原有 `WHERE published = 1` 保留。

**回归：** 组测通过；`npm test` 纳入。

| 测试 ID | 状态 |
|---|---|
| PRODUCT-PUBLISH-001 | pass |
| PRODUCT-PUBLISH-002 | pass |
| PRODUCT-PUBLISH-003 | pass |

---

### 4.2 OUTREACH-CONTACT（无联系人不得空 recipient draft / stage 5）

**根因：** `outreach_drafting` 在校验前 INSERT draft（`contact?.email \|\| ''`），中文路径无条件推进 stage=5 并清空 blocker。

**Red：** 001/002/004 失败；003（有效联系人）为路径可用，记为 happy-path 先绿。

**Green：**
- 在任何 draft / stage / blocker / `draft_ready` 之前校验 `contact_id` + 非空 email。
- 失败抛 `missing_contact: ...`，任务 `failed`。
- 成功路径用事务包裹写 draft + 更新机会 + 事件。

| 测试 ID | 状态 |
|---|---|
| OUTREACH-CONTACT-001 | pass |
| OUTREACH-CONTACT-002 | pass |
| OUTREACH-CONTACT-003 | pass |
| OUTREACH-CONTACT-004 | pass |

---

### 4.3 PROFILE-TYPE（`customer_type` 业务枚举）

**根因：** `profileSchema.customer_type = z.string()`，非法值可落库并触发后续匹配。

**Red：** 002（`high_value_partner`）、003（空串/大小写变体/数字/null）任务仍 `completed`。

**Green：**
- 单一来源 `CUSTOMER_TYPES` 常量；schema 用 `z.enum`；system prompt 拼接同一列表。
- 解析失败发生在 `applyResult` 之前（`callModel`/`schema.parse`），无画像落库、无 `profile_completed`、无 autoMatch。

**未做（规格要求）：** 未把官网 `identity.post` 的用户输入 `customerType` 强行改成同一枚举。

| 测试 ID | 状态 |
|---|---|
| PROFILE-TYPE-001 | pass |
| PROFILE-TYPE-002 | pass |
| PROFILE-TYPE-003 | pass |
| PROFILE-TYPE-004 | pass |

---

### 4.4 REMATCH / IDENTITY（accepted 不得被自动 stale）

**根因：** `rematch.post` / `identity.post`（既有客户路径）使用
`UPDATE match_results SET stale = 1 WHERE customer_id = ?`（无 status 条件）。

**Red：** REMATCH-001/003、IDENTITY-001：accepted 被标 stale=1。
**QUOTE-STALE-CHAR：** `quote.post` **当前不修改** `match_results.stale`（characterization，非缺陷断言）。

**Green：**
- 抽取 `markNonAcceptedMatchesStale(customerId)`：`status <> 'accepted'`。
- rematch / identity / agent 产品匹配共用该策略。
- **未改** `quote.post`（因其本就不失效匹配；与“三条路径隐式不一致”相比，选择记录事实而非虚构 quote 行为）。

| 测试 ID | 状态 |
|---|---|
| REMATCH-STALE-001 | pass |
| REMATCH-STALE-002 | pass |
| REMATCH-STALE-003 | pass |
| IDENTITY-STALE-001 | pass |
| QUOTE-STALE-CHAR | pass（characterization） |

**供审核的业务决策点：** 若产品认定“报价变更也应排除 accepted”，当前 quote 路径无需改 SQL；若将来 quote 增加失效逻辑，必须复用 `markNonAcceptedMatchesStale`。

---

### 4.5 HANDOFF-CONTRACT（`recommended_product` 对象/字符串）

**根因：** `recommended_product: z.string()`，结构化对象在 schema 阶段失败；空字符串可通过。

**Red：** 001 对象被拒；002 字符串未规范化；003 空串仍 completed；004 事件缺统一字段。

**Green：**
- `z.union([object{product_code, product_name}, nonEmptyString]).transform(...)` → 内部统一为对象。
- 缺字段 / 空对象 / 空串失败且不写 `handoff_summary` 事件。
- 事件 `data.recommended_product` 与 `result_json` 同形。

| 测试 ID | 状态 |
|---|---|
| HANDOFF-CONTRACT-001 | pass |
| HANDOFF-CONTRACT-002 | pass |
| HANDOFF-CONTRACT-003 | pass |
| HANDOFF-CONTRACT-004 | pass |

---

### 4.6 IMPORT-XLSX（Windows Nitro 模块加载）

**结论：pre-existing green（禁止为制造 Red 而回滚）。**

分支提交 `79a20b6 compat: add MiniMax, JSON, and Windows xlsx layers` 已在
`server/api/import/customers.post.ts` 使用：

```ts
const XLSX = createRequire(import.meta.url)('xlsx')
```

本轮**未再修改**该文件，也**未修改** `state.get.ts`。

**验证：**
- 集成：`IMPORT-XLSX-002`（隔离 DB 创建客户/联系人）、`IMPORT-XLSX-004`（缺文件/超大文件 400）pass。
- Windows smoke：`IMPORT-XLSX-001/002`（`nuxt dev` + `/api/state` + multipart import）pass；无 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。
- Windows smoke：`IMPORT-XLSX-003`（`npm run build` 后 `node .output/server/index.mjs`）pass。

| 测试 ID | 状态 | 备注 |
|---|---|---|
| IMPORT-XLSX-001 | pass | pre-existing green + Windows smoke |
| IMPORT-XLSX-002 | pass | 集成 + smoke |
| IMPORT-XLSX-003 | pass | pre-existing green + build 产物 smoke |
| IMPORT-XLSX-004 | pass | 集成 handler |

**运行注意：** smoke 使用随机端口；残留 `nuxt` 进程可能占端口，需 `taskkill` 清理。默认 `npm test` **不**包含 smoke（需 `npx vitest run tests/smoke`）。

---

## 5. 验证门禁结果

| 命令 | 结果 | 时间戳/备注 |
|---|---|---|
| `npx vitest run tests/unit tests/integration` | **22 passed / 6 files** | 2026-07-29 复跑确认 |
| `npm test` | **22 passed** | 默认不含 smoke |
| `npm run typecheck` | **exit 0** | |
| `npm run build` | **exit 0** | Nitro `node-server` |
| Windows Nitro smoke 001/002 | **pass** | Node v24.18.0 |
| Windows Nitro smoke 003 | **pass** | `node .output/server/index.mjs` |

---

## 6. 变更文件清单（本轮授权）

### 生产代码

| 文件 | 变更摘要 |
|---|---|
| `server/utils/db.ts` | 测试 DB seam；产品 seed `published`；`markNonAcceptedMatchesStale` |
| `server/utils/agent.ts` | 发布匹配边界；建联前置校验；customer_type 枚举；handoff 契约；测试 hook |
| `server/api/website/rematch.post.ts` | 使用共享 stale 策略 |
| `server/api/website/identity.post.ts` | 同上 |

### 测试与配置（新增）

| 文件 |
|---|
| `vitest.config.ts` |
| `tests/helpers/setup.ts` |
| `tests/helpers/db.ts` |
| `tests/helpers/nitro-smoke.ts` |
| `tests/unit/product-publish.test.ts` |
| `tests/unit/outreach-contact.test.ts` |
| `tests/unit/profile-type.test.ts` |
| `tests/unit/handoff-contract.test.ts` |
| `tests/integration/rematch-identity-stale.test.ts` |
| `tests/integration/import-xlsx.test.ts` |
| `tests/smoke/import-xlsx.smoke.test.ts` |

### 未改生产文件（刻意）

- `server/api/import/customers.post.ts`（xlsx 已在 `79a20b6` 修复）
- `server/api/state.get.ts`
- `server/api/website/quote.post.ts`（仅 characterization）

---

## 7. 汇总表（规格 8.10 格式）

| 测试组 | Red 证据 | Green/回归命令 | 结果 | 变更文件 | 未决风险 |
|---|---|---|---|---|---|
| PRODUCT-PUBLISH | BY004 `published=1`；上下文含 BY004；越权落库 | `vitest …product-publish` + `npm test` | pass | `db.ts`, `agent.ts`, unit 测试 | none |
| OUTREACH-CONTACT | 空 contact/空邮箱仍写 draft 并 stage5 | 同上 | pass | `agent.ts`, unit 测试 | none |
| PROFILE-TYPE | 非法类型仍 completed 并落库 | 同上 | pass | `agent.ts`, unit 测试 | 官网 identity `customerType` 未统一（按规格） |
| REMATCH/IDENTITY | accepted 被无条件 stale | 同上 + integration | pass | `db.ts`, rematch/identity, agent, integration | quote 不失效匹配（已 characterization） |
| HANDOFF-CONTRACT | 对象 schema 失败；空串可通过 | 同上 | pass | `agent.ts`, unit 测试 | none |
| IMPORT-XLSX | **pre-existing green**（`79a20b6`） | integration + Windows smoke | pass | 仅测试；生产 import 未改 | smoke 端口残留进程 |

---

## 8. 给审核模型的检查清单

请逐项判定 **通过 / 不通过 / 需澄清**：

1. [ ] Red 证据是否足以证明缺陷来自业务逻辑而非夹具错误。
2. [ ] Green 是否超出规格（过度收紧、隐藏 Provider 错误、映射为 `unknown` 等）。
3. [ ] `PRODUCT-PUBLISH-003` 在“全部未发布候选”时是否真正阻止有效匹配完成（非先插入再 stale）。
4. [ ] 建联失败是否保证无空 recipient、无 `draft_ready`、stage/blocker 不变、历史 draft 保留。
5. [ ] `customer_type` 枚举是否与 prompt 同源，且非法值无任何画像落库/自动匹配。
6. [ ] accepted stale 保护是否覆盖 rematch + identity；agent 匹配路径是否一致。
7. [ ] quote characterization 结论是否可接受，或是否要求产品决策后再改 quote。
8. [ ] handoff 规范化后，字符串兼容是否接受 `product_code: ''`（规格允许字符串→对象映射）。
9. [ ] IMPORT-XLSX 标 pre-existing green 是否合理；Windows smoke 是否足以替代“再改一遍 import”。
10. [ ] 测试 seam（`setDbForTests` / Provider mock / defer execution）是否有生产路径泄漏风险。
11. [ ] 用户既有 `.env.example` / `nuxt.config.ts` / 报告 HTML 是否被误改。
12. [ ] 是否存在未运行却标 pass 的项。

---

## 9. 建议审核结论选项

审核模型请在文末给出其一，并列出必须修改的阻断项（如有）：

- **Approve**：可进入提交/PR。
- **Approve with notes**：可提交，但需在 PR 描述中记录决策点（尤其 quote / identity customerType / handoff 空 product_code）。
- **Request changes**：列出具体文件、测试 ID、不合格理由。

---

## 10. 复现审核环境的命令

```powershell
cd D:\by56_CAP_Agent
git branch --show-current   # 期望 codex/AHa-testing
git status --short --branch

npm test
npm run typecheck
npm run build

# Windows Nitro smoke（可选但规格要求 Windows 证据）
npx vitest run tests/smoke/import-xlsx.smoke.test.ts
```

**说明：** 本报告对应工作区未提交变更；审核应以当前 working tree 为准，而非 `origin/codex/AHa-testing` 远端 tip（远端 tip 仍为 `79a20b6`）。
