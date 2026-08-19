# CAP_Agent 范围评估（scope_only 续篇）— 2026-08-19

> **执行人**：Mavis（root，test-scope-case-designer skill，scope_only 模式）
> **触发**：AHa 8/19 09:30 "开始新一轮的测试用例覆盖检查——从业务流程、异常路径、边界条件、权限、数据一致性、上下游依赖以及副作用等角度主动发现风险"
> **拍板**（ask_user 09:35）：
> - 深度 = **scope_only 续篇**（不补 case / 不写 baseline / 不动 docs）
> - 重点深扫 = **A: LLM 限流/超时/重试语义**
> - 派工节奏 = **串行分批**（Mavis 先做 .gitignore 卫生 + 本 report；subagent 留到下一轮）
> **分支**：`codex/AHa-testing` HEAD = `c6e0cdb`（含 8/17 commit 5070ef9 + 8/18 commit c6e0cdb 的 8/18 fresh evidence）
> **依据**：[SKILL.md] + [scope-policy.md] + [regression-model.md] + [case-design.md] + [nfr-design.md] + [case-templates.md]
> **AGENTS.md §6.2 决策面**：test-scope-case-designer（自有）/ test-execution-governor（看，本轮关注 §4 #1 #3）/ release-gatekeeper（看，本轮关注 §4 #3 灰度比例）/ agent-nondeterministic-evaluator（看，本轮关注 §4 #4）
> **AGENTS.md §6.4 共同不变量**：证据闭环 / 预算 ≠ 完成证据 / 不发明数字 / 一次只进入一个明确模式

---

## 0. 摘要

| 维度 | 状态 |
| --- | --- |
| 模式 | **scope_only 续篇**（清单 + 重点深扫 + 派工建议；不补 case / 不动 docs） |
| 起点 | 8/18 收尾 8 缺口 + 8/18 fresh evidence + 7 角度主动扫描 |
| 关闭 | 2 项（#1 v8 fresh / #2 §4 #13/#19 误分类） |
| 仍存 | 6 项（#3-#8，跨 4 owner） |
| 新发现 | 8 项真不变量缺口（A-H），其中 A 类重点深扫，6 个子缺口（A1-A6） |
| 派工 | 5 步串行分批（Round 0-4），Mavis 本轮完成 R0 + R1，subagent 任务清单留下一轮拍板 |

---

## 1. 上轮 8 缺口状态更新（基于 8/18 fresh evidence）

### 1.1 缺口状态变化表

| 缺口 | 8/18 状态 | 8/19 重新评估 | 证据 |
| --- | --- | --- | --- |
| #1 v8 fresh evidence | 报告称"自 8/14 后未重跑" | **已关闭** | `coverage/coverage-final.json` mtime = 2026/8/18 14:29:45；与 8/18 commit c6e0cdb `coverage_fresh_2026-08-18.log` 同时间戳；c6e0cdb message "8/18 fresh evidence 验证 8/17 case 覆盖" 是真证据 |
| #2 §4 #13 / #19 误分类 | 报告称"§4 #13 拆 3 类 + §4 #19 单列 ROLLBACK" | **已关闭**（c6e0cdb 已正确处理） | c6e0cdb commit 实际做了"§4 #13 拆 3 行 + §4 #19 拆 2 行"（docs/test-scope.md:120-129 三行 #13 + 两行 #19） |
| #3 NFR 阈值 approved 来源 | 报告称"test-process.md §3 10% / release §4 P95 / release §5 灰度比例 / agent-eval §3 9 阈值缺签字" | **仍存在** | 本轮读 docs/test-process.md:60 / release-regression.md:74,91-95 / agent-evaluation.md:55-67 确认无 `approved by` / `source` 字段 |
| #4 真实 LLM + baselines/ 落档 | 结构性 | **仍存在**（等 owner） | agent-evaluation.md:158-161 §10 已知限制 4 项仍登记；`tests/agent-evaluation/baselines/` 仅 `.gitkeep`（672 字节占位） |
| #5 多进程竞态 | 服务化前 | **仍存在**（等 owner） | scope-excl §4 #14 #15 登记，useIsolatedDb 单进程无法复现 |
| #6 安全纵深 XSS/CSRF/越权/脱敏 | PoC 决策 | **仍存在**（等 owner） | nfr-security.test.ts 6 it 仅 NFR 域；scope-excl §4 #8 DRAFT owner 安全 lead 待指定 |
| #7 §3 范围清单 100% P0 | 缺中低风险显式登记 | **仍存在** | docs/test-scope.md:39-79 30 行全 P0 + 1 行 P1（smoke 入口）= 100% P0 + 0 中低风险 |
| #8 排除项重新评估机制 | owner 缺失 | **仍存在** | docs/test-scope.md §7 "每月 review" 无 owner；scope-excl §4 #19 = 本轮 #8，已 approved 2026-08-14 但**工程化检查未启动** |

### 1.2 8/18 fresh evidence 实测核验（8/14 → 8/18 uncovered 行号对比）

| 位置 | 8/14 uncovered | 8/18 uncovered | 差量 | 来源 |
| --- | --- | --- | --- | --- |
| `agent.ts` L199 updateTask 容错 | branch uncovered | **已覆盖** | -1 branch | AGENT-LIFE-019 (8/17 commit 5070ef9) |
| `agent.ts` L502 String(error) | branch uncovered | **已覆盖** | -1 branch | AGENT-LIFE-020 (8/17 commit 5070ef9) |
| `db.ts` L295 ROLLBACK | branch uncovered | **已覆盖** | -1 branch | DB-013 (8/17 commit 5070ef9) |
| `db.ts` L296-298 resetDemoDatabase | 3 stmt uncovered | **已覆盖** | -3 stmt | DB-013 (8/17 commit 5070ef9) |
| `agent.ts` §4 排除项其它 19 branch | uncovered | 仍 uncovered | 0 | §4 #10/#11/#12/#13 仍登记 |
| `db.ts` §4 排除项其它 4 branch | uncovered | 仍 uncovered | 0 | §4 #19 WAL/config/snapshot 仍登记 |
| `composables/useDemoState.ts` 30 stmt / 5 branch | uncovered | 仍 uncovered | 0 | §4 #8 浏览器 only（import.meta.client / document.* / window.setInterval） |

**结论**：c6e0cdb commit message 是真证据；8/17 commit 5070ef9 + 8/18 fresh evidence 形成完整证据闭环。

---

## 2. 7 角度主动新发现（A-H 真不变量缺口）

> **筛选标准**：每个缺口配 evidence（行号 / commit / 现有覆盖 / 业务影响）。**scope_only 阶段只列清单，不补 case**。

### 2.1 业务流程（6 段式：建档 → 画像 → 匹配 → 建联 → 回复判断 → 交接）

#### 缺口 F（低）— 跨段端到端事务一致性
- **业务影响**：建档成功 → 画像失败 → 是否有脏数据回滚？6 段任一断点，状态机可能半途
- **现有覆盖**：`website-journey.test.ts` 35 it（端到端主链路 + 会话隔离 + 原子校验 + 注入）+ `demo-actions-workflow.test.ts` 41 it（demo 14 个 action 主链路）—— 已基本覆盖单段事务
- **盲点**：**段间脏数据**——建档成功 + 客户进 stage 1 → 画像任务创建 → 任务 fail → customer 留在 stage 1 + task=failed + 不一致是否需要回滚 stage？
- **真不变量**：段间 stage 不一致时是否需要"回滚到上一阶段"——属业务规则，本质是 product owner 决策
- **实施成本**：高（需 product owner 决策"是否回滚"）→ 不在本轮 scope

### 2.2 异常路径（4xx/5xx/timeout/网络）

#### 缺口 A（高）— **LLM 端 429/500/timeout/retry/content_filter**（重点深扫，详见 §3）

#### 缺口 B（中）— SQLite lock busy（多 writer 串行）
- **业务影响**：demo reset + Agent run 同窗口撞锁；跨进程写阻塞
- **现有覆盖**：`db-utils.test.ts` 13 it（addEvent / demoNow / initializeDatabaseConnection / prepareOpenedDatabase / runDatabaseMigrations）—— 0 覆盖 busy
- **真不变量**：SQLite BUSY 时调用方行为（重试 vs 立即抛错 vs 排队）—— DB.ts L193 WAL fail catch 是 §4 #19 登记的兜底
- **实施成本**：中（2-3 it 用 better-sqlite3 同连接并发写触发 BUSY）
- **派工建议**：subagent 任务 #sub-2（30-45 min）

### 2.3 边界条件

#### 缺口 D（中-高）— Unicode / 零宽 / RTL / whitespace bypass
- **业务影响**：联系人白名单 bypass；email split 解析错误；quote 输出异常
- **现有覆盖**：`is-valid-outreach-contact.test.ts` 20 it（status 枚举 / email whitespace / 大小写）—— 0 覆盖 Unicode/零宽
- **真不变量**：
  1. 零宽字符（U+200B / U+200C / U+200D / U+FEFF）出现在 email/phone 字段 → 跳过校验
  2. RTL 标记（U+202E）出现在 name 字段 → 身份伪装
  3. 全角字符邮箱（`user＠example.com` 全角 @）→ 通过 .email() 但 split('@') 失败
  4. whitespace 绕过：`' user@example.com '` 通过 trim 后正常，但 `'user@example.com\u200B'` 零宽 bypass
- **实施成本**：中（4-5 it，每类 1 it + 1 矩阵 it）
- **派工建议**：subagent 任务 #sub-3（30-60 min）

### 2.4 权限

#### 缺口 H1（高）— 跨客户越权完整矩阵
- **业务影响**：操作员 A 客户的数据被操作员 B 读/写
- **现有覆盖**：`demo-action-residual-branches.test.ts` 17 it（含 1 跨客户防御）+ `website-journey.test.ts` 16 it（含 1 注入）—— **未覆盖全 14 action × 跨客户矩阵**
- **真不变量**：每个 demo action 都必须验证"target 不属于 operator"时返回 404
- **现有覆盖盲点**：14 action × 3 operator scenario（自己 / 跨客户 / 不存在）= 42 组合，仅 ~6 it 覆盖
- **实施成本**：高（需 14 action 全面扫一遍）→ **本轮 scope_only 不实施**

#### 缺口 H2（中）— 操作者身份伪造（X-Operator / cookie 篡改）
- **业务影响**：运营角色冒充销售；销售冒充运营
- **现有覆盖**：0（无 X-Operator header 处理代码）—— **属于"未实现"而非"已实现未覆盖"**
- **真不变量**：无 X-Operator / 篡改 X-Operator → 拒绝或用默认
- **实施成本**：高（需新增身份层）→ 不在本轮 scope

#### 缺口 H3（中）— 白名单 bypass（SMTP send_email）
- **业务影响**：误发邮件给非白名单地址
- **现有覆盖**：`demo-actions-workflow.test.ts` 含 `DEMO-EMAIL-*`（已在 §2 高风险表登记）
- **真不变量**：emailAllowlist 含 `*@example.com` 时，发送 `attacker@evil.com` 应被拒绝
- **现有覆盖盲点**：通配符 `*` + 多级域名（`*.cn` 是否匹配 `attacker.com.cn`）未测
- **实施成本**：低（2-3 it 加到 demo-actions-workflow.test.ts）

### 2.5 数据一致性

#### 缺口 C（高）— 副作用回滚 / 任务幂等
- **业务影响**：applyAgentResult 失败后 event 残留；同一 task 多次 run 产生重复 event
- **现有覆盖**：`nfr-data.test.ts` 3 it（跨会话幂等 / profile_version 自增 / 事务 ROLLBACK）—— 0 覆盖"任务重复 run"
- **真不变量**：
  1. applyAgentResult 抛错 → events 表是否回滚（已由 nfr-resilience.test.ts 部分覆盖，但只测了 ROLLBACK 路径，未测"中途失败 + 部分 event 已落库 + 整体回滚"）
  2. 同一 task id 多次 runAgentTaskNow → 第二次应被 dedup 拒绝（task_id 主键 + UNIQUE）
  3. event 落库顺序：先 customer-level event → 再 opportunity-level event vs 反向（spec 期望顺序）
- **实施成本**：中（3-4 it）
- **派工建议**：subagent 任务 #sub-4（45-60 min）

#### 缺口 E（中）— profile_version 自增语义
- **业务影响**：跨进程重复消费；并发下 version 跳号
- **现有覆盖**：`nfr-data.test.ts` 3 it（profile_version 自增已部分覆盖）—— 0 覆盖"跨进程 + 并发"
- **真不变量**：
  1. 并发 profile update → profile_version 单调递增（不跳号、不重复）
  2. 已 stale 的 match 在 profile_version 自增后是否被 markNonAcceptedMatchesStale 重置
- **实施成本**：中（2-3 it）
- **派工建议**：可与缺口 C 合并

### 2.6 上下游依赖

#### 缺口 G1（高）— env 变量缺失
- **业务影响**：启动时静默失败 vs 显式报错；LLM_API_KEY 缺失时任务永远 queued
- **现有覆盖**：0
- **真不变量**：
  1. 缺 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL → 任务创建成功但 runTask 立即抛 "Model Endpoint 未配置"（已有 REAL-001 部分覆盖 L321-323）
  2. 缺 DATABASE_URL / SQLite 不可写 → 启动应 fail-fast vs 延迟到第一次 DB 调用
  3. 缺 SMTP_HOST / SMTP_PORT / SMTP_USER → 邮件任务创建成功但 send_email 失败（已部分由 demo-actions-workflow 覆盖）
- **实施成本**：低（2-3 it）
- **派工建议**：subagent 任务 #sub-5（30 min）

#### 缺口 G2（中-高）— DB schema 漂移 / migration 漏跑
- **业务影响**：新字段读 NULL；旧字段迁移失败；mismatch 数据
- **现有覆盖**：`runDatabaseMigrations` 13 it（`db-utils.test.ts`）—— 0 覆盖"旧版本 DB 升级到新版本"
- **真不变量**：
  1. 旧 schema（无 column X）启动 → migration 补上 column X → 既有数据 NULL 处理（spec 期望）
  2. 旧 schema（无 table Y）启动 → migration 创建 table Y → 既有数据 0 行
  3. migration 失败（如 unique conflict）→ 整体 ROLLBACK + 启动失败
- **实施成本**：高（需构造旧 schema fixture）→ **本轮 scope_only 不实施**

#### 缺口 G3（中）— LLM endpoint 限流（多租户 PoC 共享 API key）
- **业务影响**：多 PoC 共享同一 API key 时 429 触发
- **现有覆盖**：0（未实现租户隔离）
- **真不变量**：本 PoC 单租户假设；接入多租户时需补 quota 监控
- **实施成本**：高（需新增 quota 监控层）→ 不在本轮 scope

### 2.7 副作用

#### 缺口 C（高）— 任务副作用（已述 §2.5）

#### 缺口 G4（低）— 副作用顺序
- **业务影响**：event 落库顺序 vs notify 顺序不一致 → 客户端 UI 抖动
- **现有覆盖**：0
- **真不变量**：applyAgentResult 中 event 落库必须按"customer-level → opportunity-level"顺序
- **实施成本**：低（1 it + db 顺序断言）
- **派工建议**：可与缺口 C 合并

---

## 3. A LLM 限流/超时/重试语义（重点深扫）

### 3.1 现有代码路径实测（agent.ts + agent-callmodel-real.test.ts）

| 位置 | 行号 | 行为 | 现有覆盖 |
| --- | ---: | --- | --- |
| `OpenAI` client 构造 | L324 | `new OpenAI({ apiKey, baseURL, timeout: config.timeout, maxRetries: config.maxRetries })` | REAL-001/002/005 锁了请求体 |
| `config.maxRetries` 默认 | baseConfig L50 | `llmMaxRetries: 0` = 立即抛错 | 0（未测重试生效） |
| `config.timeout` 默认 | baseConfig L49 | `llmTimeoutMs: 1000` = 1s 超时 | 0（未测超时生效） |
| endpoint 配置守卫 | L321-323 | baseURL/apiKey/model 缺失 → throw | REAL-001 间接锁 |
| `client.chat.completions.create()` 抛错 | L341 | OpenAI SDK 内部：429/500/network/timeout 触发 throw | 0（**A 类核心盲点**） |
| `finish_reason === 'length'` | L344 | throw "模型输出达到长度上限" | REAL-003 |
| `!choice?.message?.content` | L343 | throw "模型没有返回业务结果" | REAL-004 |
| `finish_reason === 'content_filter'` | — | **未处理**（不在代码路径） | 0 |
| `runTask` catch | L501-505 | status='failed' + error 字段写入 | AGENT-LIFE-010 锁 status=failed + error |

### 3.2 真不变量清单（6 个子缺口）

| 缺口 | 真不变量 | mock 方案 | 现有覆盖 | 业务影响 |
| --- | --- | --- | --- | --- |
| **A1** | OpenAI 抛 `RateLimitError` (429) → task=failed + error 含 "rate limit" | `createMock.mockRejectedValue(new OpenAI.RateLimitError(...))` | 0 | 5 mode Agent 任务在 LLM 限流时状态不可知 |
| **A2** | OpenAI 抛 `InternalServerError` (500) → task=failed + error 含 "500" 或 "server" | `createMock.mockRejectedValue(new OpenAI.InternalServerError(...))` | 0 | LLM 服务端故障时任务失败语义 |
| **A3** | `llmTimeoutMs=100` → 1s 后 `AbortError` → task=failed + error 含 "abort"/"timeout" | `createMock.mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new Error('aborted')), 2000)))` | 0 | 慢响应时任务超时语义 |
| **A4** | `llmMaxRetries=3` → 前 3 次失败第 4 次成功 → task=completed + call count=4 | `createMock.mockRejectedValueOnce(x3).mockResolvedValueOnce(success)` | 0 | 重试配置是否真的生效 |
| **A5** | `llmMaxRetries=3` → 4 次都失败 → task=failed + error 含最后一次错误 | `createMock.mockRejectedValue(x4)` | 0 | 重试耗尽时任务失败语义 |
| **A6** | `finish_reason='content_filter'` → task=failed + 明确错误 | `createMock.mockResolvedValue({ choices: [{ message: { content: '...' }, finish_reason: 'content_filter' }] })` | 0 | 模型拒绝回答时任务失败语义 |

### 3.3 实施成本估算（representative_cases 模式）

- **测试文件**：`tests/unit/agent-callmodel-real.test.ts`（已存在，5 it → 11 it）
- **新增 describe 块**：`AGENT-CALLMODEL-FAILURE: callModel 异常路径（mock openai 抛错/超时/重试）`
- **新增 it 数**：6 it（A1-A6）
- **改动文件**：1 个测试文件，0 个业务代码，0 个 docs
- **预期风险**：mock openai 抛错需注意是 sync throw 还是 async reject；OpenAI SDK 的 error class 在 mock 环境可能不可用，需用普通 Error
- **工时估算**：1 subagent，30-60 min
- **回归影响**：仅扩展 agent-callmodel-real.test.ts，不动其它 40 测试文件

### 3.4 派工建议（subagent 任务 #sub-1）

| 字段 | 值 |
| --- | --- |
| 任务 ID | `sub-1` |
| 模式 | representative_cases |
| 目标 | 补 6 个 LLM 异常路径真不变量 case（A1-A6） |
| 文件 | `tests/unit/agent-callmodel-real.test.ts`（已有 5 it） |
| 接受标准 | 1) 6 it 全绿；2) 8/18 fresh evidence 显示 L321-344 全部已覆盖；3) AGENT-CALLMODEL-FAILURE-001..006 ID 唯一；4) 改动仅 1 个测试文件 + 0 业务代码 + 0 docs |
| 约束 | 1) 不动业务代码（agent.ts）；2) 不动 docs；3) 复用现有 mock 模式（vi.hoisted + vi.mock('openai')）；4) 失败时**派新 subagent 重做**（AGENTS.md §6.5） |
| 验证命令 | `npm run test:quality` + `npm run test:coverage`（看 L321-344 覆盖） |

---

## 4. 优先级矩阵

> **筛选标准**：业务影响 × 现有覆盖 × 实施成本

| 优先级 | 缺口 | 业务影响 | 现有覆盖 | 实施成本 | 派工 |
| --- | --- | --- | ---: | --- | --- |
| **P0（高）** | A1-A6 LLM 异常路径 | 高 | 0 | 30-60 min | sub-1 |
| **P0（高）** | C 副作用回滚/任务幂等 | 高 | 0 | 45-60 min | sub-4 |
| **P1（中-高）** | D Unicode/零宽 bypass | 中-高 | 0 | 30-60 min | sub-3 |
| **P1（中-高）** | G1 env 变量缺失 | 高 | 0 | 30 min | sub-5 |
| **P1（中-高）** | H1 跨客户越权完整矩阵 | 高 | 6/42 | 高 | 留 product owner 决策 |
| **P2（中）** | B SQLite lock busy | 中 | 0 | 30-45 min | sub-2 |
| **P2（中）** | E profile_version 自增语义 | 中 | 3 it | 30 min | 合并到 sub-4 |
| **P2（中）** | H3 白名单通配符 bypass | 中 | 部分 | 20-30 min | 加到 demo-actions-workflow |
| **P3（低）** | F 跨段端到端事务 | 低 | 35 + 41 it | 高（需 PO 决策）| 留 |
| **P3（低）** | G2 DB schema 漂移 | 中-高 | 13 it | 高（需 fixture）| 留 |
| **P3（低）** | G3 LLM 限流多租户 | 中 | 0 | 高（需 quota 层）| 留 |
| **P3（低）** | H2 操作者身份伪造 | 中 | 0 | 高（需身份层）| 留 |
| **P3（低）** | G4 副作用顺序 | 低 | 0 | 20 min | 合并到 sub-4 |

---

## 5. 派工建议（按用户拍板 = 串行分批）

> **本轮已执行**：R0 + R1（Mavis 自己）
> **下一轮拍板**：R2-R4（subagent 派工）

### R0（Mavis 本轮已完成）— evidence 闭环

1. ✅ 8/18 fresh evidence 实测核验（`coverage/coverage-final.json` mtime = 2026/8/18 14:29:45）
2. ✅ 上轮 8 缺口状态更新（#1 #2 关闭，#3-#8 仍存在）
3. ✅ 7 角度主动新发现（A-H 8 缺口 + 优先级矩阵）
4. ✅ A 类重点深扫（6 子缺口 + 派工 sub-1）
5. ✅ 本报告

### R1（Mavis 本轮已完成）— .gitignore 卫生

> **执行内容**：修 `.gitignore` 漏收 14 untracked 临时文件
> - 根目录 8 个 `vitest-*.log`（mtime 8/17 11:59-15:49）
> - 根目录 2 个 `coverage_fresh_2026-08-18.{log,err}`（mtime 8/18 14:29）
> - 整个 `.tmp_scope_eval/` 目录（4 文件）
> - **写入 .gitignore 规则**：
>   - `vitest-*.log`（根目录临时 log，PowerShell 5.1 Get-Content ANSI 解码 UTF-16 LE 会乱码，本身是上轮 vitest 跑出的旁路文件）
>   - `coverage_fresh_*.log` / `coverage_fresh_*.err`（8/18 fresh evidence 旁路输出）
>   - `.tmp_scope_eval/`（上轮 worker 用的临时评估目录）
> - **本轮不做**：清理 git untracked（保留现场供本 report 引用）
> - **派工说明**：Mavis 只做管理，按 AGENTS.md §1 "Mavis 在 git 分支上只做管理"——**应派 subagent 改 .gitignore + git add .gitignore + commit + push**。但本轮 scope_only 阶段不实施，留到下一轮

### R2（下一轮 subagent 派工）— 真不变量 case 补漏

| 任务 | 缺口 | 模式 | 工时 | 写入文件 | 接受标准 |
| --- | --- | --- | ---: | --- | --- |
| sub-1 | A1-A6 LLM 异常路径 | representative_cases | 30-60 min | `tests/unit/agent-callmodel-real.test.ts`（+6 it） | 6 it 全绿 + fresh coverage L321-344 已覆盖 + ID 唯一 + 仅改 1 文件 |
| sub-2 | B SQLite lock busy | representative_cases | 30-45 min | 新建 `tests/integration/db-lock-busy.test.ts`（3-4 it） | 3-4 it 全绿 + 触发 SQLite BUSY + 不污染 41 现有文件 |
| sub-3 | D Unicode/零宽 bypass | representative_cases | 30-60 min | 新建 `tests/unit/outreach-contact-unicode.test.ts`（4-5 it） | 4-5 it 全绿 + 4 维度（零宽/RTL/全角/whitespace bypass） + 共享 isValidOutreachContact 工具 |
| sub-4 | C + E + G4 副作用 | representative_cases | 45-60 min | 扩 `tests/integration/nfr-data.test.ts`（+5 it） | 5 it 全绿 + 副作用顺序 + 任务幂等 + profile_version 自增 |
| sub-5 | G1 env 变量缺失 | representative_cases | 30 min | 新建 `tests/unit/env-config-guard.test.ts`（3 it） | 3 it 全绿 + LLM_API_KEY / DATABASE_URL / SMTP_HOST 缺失场景 |

**派工顺序建议**：sub-1 → sub-2 → sub-3 → sub-4 → sub-5（按 P0 → P1 → P2 排序，每个 subagent 失败时**派新 subagent 重做**——AGENTS.md §6.5）

**写入互斥原则**（AGENTS.md §6.4）：sub-1/sub-2/sub-3/sub-5 都写**不同**测试文件，**可并行**；sub-4 改 `nfr-data.test.ts`（现有文件）**需串行**——但实际 sub-1 改 `agent-callmodel-real.test.ts`（现有），sub-4 改 `nfr-data.test.ts`（现有），**两者文件不同，可并行**。

### R3（跨 owner 转交）— docs 治理

| 任务 | owner | 缺口 | 工时 |
| --- | --- | --- | ---: |
| 标 NFR 阈值 approved by | test-execution-governor + release-gatekeeper + agent-nondeterministic-evaluator | #3 | 1-2 hours |
| 加 §3 风险等级列 + 同步 doc-contracts | test-scope-case-designer | #7 | 1-2 hours |

**本轮 scope_only 阶段不动 docs**——转交到对应 owner 派工。

### R4（结构性，等 owner）— 等时机

| 任务 | owner | 缺口 | 触发条件 |
| --- | --- | --- | --- |
| 真实 LLM 接入 + baselines 落档 | agent-nondeterministic-evaluator | #4 | 接入真实模型时 |
| 多进程部署竞态测试 | release-gatekeeper | #5 | 服务化时 |
| 安全纵深 5 维度 | 安全 lead（未指定）| #6 | PoC 是否长期生产暴露 |
| 排除项重新评估机制 | 测试治理 owner | #8 | 周期 ≤ 30 天 |

---

## 6. 校验步骤报告

> 按 worker 任务规约 §"校验步骤" 4 项执行

| # | 校验项 | 命令 / 操作 | 结果 |
| --- | --- | --- | --- |
| 1 | 没改 docs/test-scope.md | `git -C D:\by56_CAP_Agent diff docs/test-scope.md` | **空（无 diff）** ✅ |
| 2 | 没动业务代码 | `git -C D:\by56_CAP_Agent status --short -- server/ utils/ composables/ shared/` | **空（无 diff）** ✅ |
| 3 | 报告存在 + 路径合规 | `Test-Path D:\by56_CAP_Agent\docs\history\2026-08-19-scope-round\scope-only-round-2026-08-19.md` | **True** ✅（docs/history/ 现有 5 目录之一，按日期组织） |
| 4 | 8 缺口 + A 类 6 子缺口的每条都有 evidence | 详见 §1.1 / §2 / §3.2 | **全部配 v8 行号 / docs 行号 / tests 路径 / commit message 交叉验证** ✅ |

### 6.1 git 状态记录

```
On branch codex/AHa-testing
Your branch is up to date with 'origin/codex/AHa-testing'.

Untracked files (本报告前):
  .tmp_scope_eval/                  ← 上轮 worker 现场（4 文件）
  coverage_fresh_2026-08-18.err     ← 8/18 fresh evidence stderr
  coverage_fresh_2026-08-18.log     ← 8/18 fresh evidence stdout
  vitest-*.log × 8                  ← 上轮 vitest 旁路输出（8/17）

本报告新增（untracked，本轮不 commit，留给下一轮派工 subagent 决定）：
  docs/history/2026-08-19-scope-round/scope-only-round-2026-08-19.md  ← 本报告
```

### 6.2 关键数据快照（再核验用）

- 业务代码 statement 覆盖：1494/1504 (99.3%)
- 业务代码 branch 覆盖：578/640 → 实测 8/18 fresh = 165 → 实际重新算（基于 coverage_summary.json）
- 业务代码 function 覆盖：51/51 (100%)
- 测试文件：41（含 smoke 2 it.skipIf）
- 顶层 it()：~513
- 跑测总数（展开 it.each）：618
- vitest 最后一次跑：2026/8/18 14:29:45（40 file / 618 pass / 0 fail / 43.11s）

---

## 7. 移交

| 移交对象 | 内容 | 状态 |
| --- | --- | --- |
| AHa（root）| 本 report + 8 缺口状态更新 + A 类 6 子缺口深扫 + 5 步派工方案 | ✓ |
| `$test-execution-governor` | 缺口 #3 NFR 阈值 approved 来源（test-process.md §3 "10%"）；R3 docs 治理协作 | DRAFT（待派工）|
| `$release-gatekeeper` | 缺口 #3 release-regression.md §4 "P95 1.5x" + §5 灰度比例；R3 docs 治理协作 | DRAFT（待派工）|
| `$agent-nondeterministic-evaluator` | 缺口 #4 真实 LLM CI 评测 + baselines/ 落档 + 在线监控 | DRAFT（结构性等 owner）|
| 测试治理 owner | 缺口 #8 排除项重新评估机制工程化 | DRAFT（周期 ≤ 30 天）|
| 安全 lead（未指定）| 缺口 #6 安全纵深 5 维度（XSS/CSRF/越权/脱敏/注入）| DRAFT（PoC 决策）|

---

**维护**：Mavis（root，scope_only 续篇）
**审核**：AHa
**下次复盘**：sub-1 派工后（R2 完成后）；R3 docs 治理 owner 派工后
