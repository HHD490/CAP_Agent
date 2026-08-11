# 测试范围补充决定（2026-08-11）

> **范围**：NFR 域（性能 / 可用性 / 安全 / 韧性 / 可观测 / 数据完整性 / 成本）补缺，**scope_only 模式**
> **依据**：[test-scope-case-designer](../../../quality_tests_skills/skills/07-quality-evaluation-release/test-scope-case-designer/SKILL.md) §"输出与参考" + [nfr-design.md](../../../quality_tests_skills/skills/07-quality-evaluation-release/test-scope-case-designer/references/nfr-design.md)
> **触发**：评审发现 + 历史缺陷/事故回看（7-28 原始问题定位、7-29 四轮修复活动、8-05 / 8-07 两轮 scope 补充）
> **本决定作用**：把"NFR 补什么、补到多深、谁负责批阈值"落成符合 5 skills 流水线要求的**正式范围交付物**；不展开可执行用例

| 字段 | 内容 |
| --- | --- |
| 活动 ID | SCOPE-NFR-2026-08-11 |
| 分支 | `codex/AHa-testing` |
| 依据基线 | 2026-08-07 累计 482 用例 / 24 unit + 5 integration + 1 smoke + 100 agent-eval + 16 NFR 证据 |
| 工具链 | vitest 3.2.7 / Node v22+ / Windows + PowerShell |
| 责任人 | Mavis |
| 交付深度 | **scope_only**（不出可执行用例；下一步走 representative_cases 须经本决定批准） |
| 状态 | **DRAFT**（无三方评审签字，按 case-design.md §"评审与维护"不能标 APPROVED） |

---

## 1. 范围结论

### 1.1 风险等级与关键依据

| 缺口 | 风险等级 | 关键依据 |
| --- | ---: | --- |
| 性能基线 vs 当前对比缺位 | **高** | `tests/integration/nfr-evidence.test.ts` 4 条性能用例都是单点 spec_default（state 100ms / action 200ms / xlsx 5s / task 50ms）；**没有"基线 vs 候选"对比、没有用户旅程级（建档→画像→匹配→建联→回复→交接）端到端延迟、没有峰值/突发/长稳场景**。任何代码改动都缺乏"性能是否漂移"的客观护栏 |
| 韧性/降级路径几乎空白 | **高** | 现有 RES-001（重置）/ RES-002（事务成功路径）/ RES-003（sync_wca 33 封顶）**只测正常路径与重置**，不测"模型失败 → 业务降级"、"SMTP 不可用 → 演示态白名单拒绝"、"LLM 429 → 重试放大"、"JSON parse 失败 → schema 拒绝"、"xlsx 损坏 → 400 错误信息完整性"。7-29 修复的 6 组缺陷里有 3 组（PROFILE-TYPE / HANDOFF-CONTRACT / IMPORT-XLSX）属于"异常路径错误"——证明此类路径历史高发 |
| 安全覆盖仅 xlsx 边界 + 注入字符串 | **高** | SEC-001/002/004 覆盖 xlsx 5MB / SQL 注入 / email 白名单；SEC-005 是 contact 状态机（实为业务规则）。**未覆盖**：XSS / CSRF / Prompt 注入（`docs/agent-evaluation.md` 100 用例里只有 HANDOFF-009 一条）/ 越权（水平+垂直）/ 传输加密 / 敏感数据落库与日志脱敏 / Agent 工具权限绕过。Agent 项目按 scope-policy §"安全"是**必测** |
| 真实模型接入前的 NFR 准备 | **中** | `docs/test-tool.md` §10 明确登记："真实 LLM CI 评测未启用" / "NFR 工具缺失" / "正式 SMTP 服务"是已知边界；`docs/agent-evaluation.md` §10 列出 4 个待办（真实模型 CI、基线未生成、在线监控、人工抽检）。**任何"接模型"动作都会先撞到这层 NFR 缺位** |
| 可观测/可运维缺位 | **中** | OBSERV-001/002/003/004 覆盖"错误响应结构 / 任务 step 留痕 / 事件 data_json / 关联字段"——是局部可观测。**没有**：Trace 关联 ID、监控告警路由、仪表盘完整性、错误日志脱敏抽检、Runbook 演练。NFR 5 skills 要求"可观测、可运维"是独立域，现状合并到"安全/韧性"里，颗粒度不足 |
| NFR 排除项无重新评估机制 | **中** | `docs/test-scope.md` §4 把"性能压测 / UI 自动化 / 真实 LLM 评测 / 跨浏览器 / i18n"全部标为 PoC 排除；`docs/test-pipeline.md` §7 写"每月 review 一次排除项，重新评估"但**未跟踪**。评审/缺陷活动持续触发"是否纳入 NFR"的判断，但缺一条"什么时候重评"的规则 |
| 数据完整性 / 幂等边界 | **中** | 已有 `markNonAcceptedMatchesStale` 幂等 / `createAgentTask` dedup / `legacy-publish` 幂等迁移；**没有**：跨会话幂等、并发场景下数据一致性、复制延迟、对账。SQLite 单写锁 + Node 单进程避开了"现网并发"问题，但**记录事实 ≠ 覆盖** |
| 成本 / 效率 | **低** | 单 mode 单次 LLM 调用的 Token 成本 / 重试放大 / 缓存命中无任何 NFR 判据；接入真实模型时无成本基线 → 漂移不可见 |

### 1.2 建议深度

按 nfr-design.md "NFR 分类与测试方法" + scope-policy.md "风险与默认深度"：

- 高风险（性能基线 / 韧性降级 / 安全纵深）：**全量 NFR 场景 + 性能基线 + 韧性/降级/恢复演练 + 安全专项**；CP0
- 中风险（真实模型准备 / 可观测 / 排除项机制 / 数据完整性）：**核心场景 + 接口/契约 + 流程性护栏**；CP0-CP1
- 低风险（成本）：**NFR 设计草案 + 监控指标，不强制 case 化**；CP2
- 通用不做（按 `test-scope.md` §4 已登记排除，本轮仍维持）：真实压测 / 跨浏览器 / UI 自动化 / 真实 LLM CI 评测（仅做"接入前的准备"）/ i18n

### 1.3 主要未决项

- [ ] NFR 阈值（性能 / 可用性 / 安全 / 韧性）当前为 **spec_default 草案**（test-pipeline.md §3.2 + nfr-evidence.test.ts 注释），**无 project_approved 阈值**——按 nfr-design.md "缺失阈值与冲突处理"，**不发明数字**；需产品 + 研发 + SRE 联合签字
- [ ] 韧性/降级路径：是否在 PoC 阶段就纳入"模型失败 → 默认画像"等业务降级？还是等接入真实模型时再补？**待用户决策**
- [ ] 安全纵深（XSS / CSRF / Prompt 注入 / 越权 / 脱敏）的优先级——PoC 单浏览器演示是否需要？**待产品决策**
- [ ] 真实模型接入前的 NFR 准备（评测执行框架 / 基线生成 / 在线监控）属 `agent-nondeterministic-evaluator` 治理范畴，本 scope 只登记"待补"，**不出用例**
- [ ] 性能基线与"用户旅程级"端到端：是否对 6 段旅程（建档→画像→匹配→建联→回复→交接）全量配基线？还是只配建联/回复/交接 3 段（Agent 介入的核心）？**待产品决策**
- [ ] NFR 排除项的重新评估节奏：文档写"每月 review 一次"但无 owner / 触发器；**待维护者确认是否需要"每轮 scope 补充活动"强制复评**

---

## 2. 变更与影响

### 2.1 需求 / 代码 / 配置 / Prompt / 模型 / 工具 / 知识库

| 维度 | 变化 | 备注 |
| --- | --- | --- |
| 业务代码 | **无** | scope_only 模式不改任何业务文件；本轮仅文档 + （下一步）测试代码 |
| 配置 | **无** | `.env.example` / `nuxt.config.ts` 行尾差异属预先存在，未提交 |
| Prompt / 模型 / 工具 / 知识库 | **无** | 不在本次范围 |
| 测试代码 | **下一步** | 走 representative_cases 模式后，扩 `tests/integration/nfr-evidence.test.ts`（+N 条）+ 视情况新建 `tests/integration/nfr-resilience.test.ts` / `nfr-security.test.ts` |
| 文档 | **+1 文件 / 1 处更新** | 本决定 + `docs/test-scope.md` §3 / §4 同步计数 + `docs/test-pipeline.md` §3.2 阈值表加"待批准"标识 |

### 2.2 模块 / 接口 / 数据流 / 依赖

| 维度 | 现有依赖 | 本次影响 |
| --- | --- | --- |
| `tests/integration/nfr-evidence.test.ts`（16 用例） | 性能 / 可观测 / 安全 / 韧性 4 域局部覆盖 | 扩 N 条，**不破坏**现有阈值；新增场景使用 spec_default 草案，**不**作为门禁 |
| `tests/agent-evaluation/core-regression.json`（100 用例） | 5 mode × 20；安全 1 条（HANDOFF-009） | 不在本次范围（属 `agent-nondeterministic-evaluator`） |
| `tests/smoke/import-xlsx.smoke.test.ts` | 真实 Windows Nitro dev/build | 不在本次范围 |
| `docs/test-pipeline.md` §3.2 覆盖率表 | 关键模块 ≥80% | 不变；本次仅在 NFR 阈值表加"待批准"标识 |
| `docs/test-scope.md` §3 范围清单 + §4 排除项 | 5 skills 流水线 | §3 末尾加 NFR 子表；§4 排除项触发器加"重新评估条件"列 |

### 2.3 上下游 / 数据一致性 / 权限 / 资金 / 高频路径 / 历史脆弱点

- 暂无业务代码变更，因此**不存在数据一致性 / 权限 / 资金影响**
- 不影响高频路径
- 不引入新依赖（仍只用 vitest + Node `performance.now()` + `useIsolatedDb`；性能场景不引入 k6 / autocannon 等，按 `test-tool.md` §10 "NFR 工具缺失"治理）
- 历史脆弱点（`scripts/agent-eval-report.mjs --check` 100 用例护栏）：本次不动 Agent 评测集，下一轮 representative_cases 仍要复跑确认

---

## 3. NFR 当前覆盖盘点（按 5 skills nfr-design.md 9 大域）

> 依据：`tests/integration/nfr-evidence.test.ts`（16 用例，4 域） + `docs/agent-evaluation.md` §3（9 阈值） + `docs/test-pipeline.md` §3.2

| NFR 域 | 当前用例数 | 覆盖深度 | 主要缺口 |
| --- | ---: | --- | --- |
| 性能 / 容量 / 可扩展性 | 4 | 单点 spec_default（state 100ms / action 200ms / xlsx 5s / task 50ms） | 无基线对比 / 无用户旅程级 / 无峰值/突发/长稳 / 无并发 / 无 Token 成本 |
| 可用性 / 可靠性 | 0 | 隐式（无 SLI/SLO/SLA 文档化） | 完全没有量化判据 |
| 韧性 / 降级 / 恢复 | 3 | 事务成功路径 / 重置 / 容量封顶 | 无故障注入 / 无降级输出 / 无回滚 / 无 RTO/RPO |
| 安全 / 隐私 / 合规 | 5 | xlsx 5MB / SQL 注入字符串 / 200 行 / email 白名单 / contact 状态机 | 无 XSS / CSRF / Prompt 注入 / 越权 / 传输加密 / 脱敏 / Agent 工具权限绕过 |
| 兼容 / 互操作 | 0 | 仅 Chrome 演示（test-scope.md §4 排除） | 维持排除，触发"重新评估条件"未跟踪 |
| 可观测 / 可运维 | 4 | 错误响应结构 / 任务 step / 事件 data_json / 关联字段 | 无 Trace 关联 / 无告警路由 / 无仪表盘 / 无日志脱敏抽检 |
| 可维护 / 可测试 | 16 | 测试 helper（setup / db / nitro-smoke）已配置 | 无配置外置检查 / 无注入依赖检查 |
| 数据完整性 / 一致性 | 3 | legacy-publish 幂等 / markNonAcceptedMatchesStale 幂等 / task dedup | 无跨会话幂等 / 无并发一致性 / 无对账 |
| 易用性 / 无障碍 | 0 | 演示态（test-scope.md §4 排除） | 维持排除，触发"重新评估条件"未跟踪 |
| 成本 / 效率 | 0 | 完全无 | 无 Token / 缓存 / 重试放大 / 预算压力场景 |

**当前 NFR 覆盖总结**：核心 4 域有局部证据，但**没有一项目前 NFR 用例是"基线对比"或"用户旅程级"或"故障注入"**。这与 scope-policy.md "项目类型矩阵（Agent: 性能 大版本/高风险）"的指导一致——目前既无基线，也无对比 → 任何 NFR 假设都站不住脚。

---

## 4. 测试范围（含 CP 标签草案）

> 标签约定（依 case-design.md §"通用用例模板"）：
> - `case_priority`: **CP0** = 必测，**CP1** = 应测，**CP2** = 按需，**CP3** = 排除前可选
> - **注意：CP 标签不是缺陷严重度 P0-P4**
> - 本轮 scope_only 模式只列**对象 + 风险 + 测试类型 + 深度 + CP 标签**，**不**展开具体用例 ID 与 Oracle

| NFR 域 | 对象 | 风险依据 | 测试类型 | 深度 | 优先级 | 阈值状态 |
| --- | --- | --- | --- | ---: | --- | --- |
| 性能 | 6 段用户旅程（建档→画像→匹配→建联→回复→交接）端到端延迟 | 单点不足以描述"演示流畅" | 性能 | 用户旅程级 | **CP0** | **UNAPPROVED**（草案，基线为 0） |
| 性能 | state.get / demo action / xlsx import / agent task p95 / p99 | 单点 + 无基线 → 漂移不可见 | 性能 | 基线 vs 候选对比 | **CP0** | **UNAPPROVED**（现有 spec_default 100/200/5000/50ms 是 spec_default） |
| 性能 | 高频路径并发（5/10/20 并发 demo action） | 演示场景多运营同时操作 | 性能 | 并发 / 阶梯 | **CP1** | **UNAPPROVED** |
| 可用性 | `state.get` / `quote.post` / `rematch.post` SLI 口径 | 文档化 SLI 是 SLO 的前提 | 可用性 | 指标定义 | **CP0** | **UNAPPROVED** |
| 韧性 | 模型失败 → 业务降级（默认画像 / 跳过匹配） | 7-29 修复的 PROFILE-TYPE / HANDOFF-CONTRACT 提示：异常路径高发 | 韧性 | 故障注入 | **CP0** | spec_default 草案 |
| 韧性 | SMTP 不可用 / LLM 429 / xlsx 损坏 / JSON parse 失败 | 7-29 修复的 IMPORT-XLSX 是真实事故 | 韧性 | 故障注入 + 降级输出 | **CP0** | spec_default 草案 |
| 韧性 | 事务失败 ROLLBACK 路径（与现有 RES-002 互补） | 现有 RES-002 只测成功路径 | 韧性 | 故障注入 | **CP0** | spec_default 草案 |
| 安全 | XSS（website quote 提交框 / contact 邮箱 / customer name） | 公开 web 是 PoC 第一道门面 | 安全 | 自动化扫描 + 人工 | **CP0** | 待 OWASP 草案 |
| 安全 | CSRF（demo action / agent task HTTP） | PoC 单浏览器但接口对外 | 安全 | token 缺失 / 跨域 | **CP2** | 待 OWASP 草案 |
| 安全 | Prompt 注入（5 mode 输入污染） | `core-regression.json` 仅 HANDOFF-009 一条 | 安全 | 对抗集 | **CP0** | spec_default 草案 |
| 安全 | 越权（水平 + 垂直）：cross-customer 匹配 / cross-opportunity draft 读取 | `server/utils/contact.ts` 已有 `isValidOutreachContact` 但未覆盖水平越权 | 安全 | 矩阵 | **CP0** | spec_default 草案 |
| 安全 | 敏感数据落库与日志脱敏（LLM_KEY / SMTP_PASS / contactable email 出现在日志） | `docs/test-tool.md` §5.1 已登记"测试态密钥必须保留占位" | 安全 | 脱敏抽检 | **CP0** | spec_default 草案 |
| 安全 | Agent 工具权限绕过（tool call 越权改 customer / opp） | NFR 域"Agent 越狱"被 scope-policy.md 列为**必测** | 安全 | 对抗 | **CP0** | spec_default 草案 |
| 可观测 | Trace 关联 ID（task ↔ event ↔ draft ↔ step 全链路） | 现有 OBSERV-003/004 只测局部 | 可观测 | 字段完整 | **CP1** | spec_default 草案 |
| 可观测 | 错误日志脱敏抽检（不允许 LLM_KEY / SMTP_PASS / 邮箱明文） | 与"安全脱敏"复用 | 可观测 | 脱敏 | **CP0** | spec_default 草案 |
| 数据完整性 | 跨会话幂等（同一 customer 多次 manual_customer） | SQLite 单进程但需记录事实 | 数据完整性 | 重放 | **CP1** | spec_default 草案 |
| 成本 | 5 mode 单次调用 Token 数 / 总成本 | 接入真实模型时无基线 → 漂移不可见 | 成本 | 单次成本 + 缓存命中 | **CP2** | UNAPPROVED（项目无 token 计费） |
| 通用 | NFR 排除项重新评估机制 | 文档写"每月 review 一次"无 owner | 流程 | 触发器 + owner | **CP0** | 文档化 |

### 4.1 工具能力与移交（test-tool-governor §"输出契约"）

- `selection_decision`: **采用**（仅用现有 vitest + `useIsolatedDb` + Node `performance.now()` + 业务 handler；不引入 k6 / autocannon / Playwright / 真实 LLM）
- `execution_authorization`: **ALLOWED**（仅本地仓库内运行，零外部副作用）
- 首选：vitest 3.2.7（已批准工具）
- 备选：N/A（无候选；如真实模型接入后须用 scripts/agent-eval-runner.mjs）
- 拒绝选型：未尝试 k6 / autocannon / Playwright / 真实 LLM（依 test-scope.md §4 / test-tool.md §10 治理规则）
- NFR 工具缺失的补救：基线对比用"测试同时跑两次取比值"避免硬编码阈值；故障注入用 `vi.spyOn` / `mockReturnValueOnce` 拒绝错误

### 4.2 与 `test-process-governor` 的衔接

- 准出：本轮 scope_only 模式不产生准出信号；下一步 representative_cases 模式才进入 `test-process-governor` 阶段台账
- 暂停条件：如发现 NFR 阈值必须有 project_approved 才能定 → 立即升级为 BLOCKED
- 复盘节奏：本决定写明后，下一轮（representative_cases 提交时）必须复评 §1.3 未决项

---

## 5. 排除、假设与未知项

| 项目 | 原因 / 假设 | 剩余风险 | 责任人 / 批准角色 | 重新评估条件 |
| --- | --- | --- | --- | --- |
| 真实压测（k6 / autocannon） | PoC 30+8+3 客户量级，性能瓶颈不在吞吐 | 真实负载下延迟未知 | Mavis | 客户数 > 1000 或服务化时 |
| 跨浏览器兼容 | 仅 Chrome 演示 | 其他浏览器可能样式 / 交互问题 | Mavis | 客户端版本立项 |
| 真实 LLM 端到端评测 | PoC 不接生产模型 | Agent 行为真实表现未验证 | Mavis | 接入真实模型时启用 `agent-evaluation/*` |
| UI 自动化 | 仅 Chrome 演示 | 回归频繁时手工成本高 | Mavis | 进入长期版本或回归频繁时评估 |
| 性能基线数字（CP0 对象） | 无 project_approved 阈值 | 任何阈值都需产品 / 研发 / SRE 联合签字 | 待指定 | 产品 + 研发 + SRE 联合评审后启用 |
| 韧性降级输出（CP0 对象） | 是否纳入 PoC 范围待决策 | 接入真实模型时无降级兜底 | Mavis | 用户对 §1.3 第 2 项决策后启动 |
| 安全纵深（XSS / CSRF / 越权 / 脱敏） | PoC 单浏览器演示是否需要 | 公开 web 暴露后无防御 | Mavis | 产品对 §1.3 第 3 项决策后启动 |
| 真实模型接入前的 NFR 准备 | 属 `agent-nondeterministic-evaluator` 治理 | 接入即撞 NFR 缺位 | Mavis | 接入真实模型时由 agent-evaluator skill 启动 |
| 用户旅程级端到端性能 | 配全 6 段还是只配 3 段 Agent 核心 | 资源 / 工时分配 | Mavis | 产品对 §1.3 第 5 项决策后启动 |
| 排除项重新评估机制 | 文档写"每月 review 一次"无 owner | 长期遗漏 | 待指定 owner | 用户对 §1.3 第 6 项决策后启动 |
| `recommendProducts` 大规模性能 | 单次调用 1 个 SQL + N 次 JSON.parse；N=10000 未实测 | 真实负载下延迟未知 | Mavis | 客户数 > 1000 时 |
| `opportunity-stages` 文案国际化 | 当前 `as const` 元组是中文 | 国际化后 stage 顺序与计数失真 | Mavis | 国际化时同步重排 `state.ts` / `advance-time.post` |
| 9 阶段常量扩展到 10+ | 当前长度 9 与 7 步推进流程强耦合 | 长度变化会断 `state.ts` 计数 | Mavis | 业务增加新阶段时同步扩展 |
| `applyAgentResult` 多 customer 并发竞态 | SQLite 单写锁 + Node 单进程 | 多进程部署时可能 | Mavis | 服务化或多进程时 |
| `set_contact` 跨 SELECT/UPDATE 改 status 竞态 | 同上 | 多进程部署时可能 | Mavis | 服务化或多进程时 |
| `markNonAcceptedMatchesStale` 时间口径 | 双方都用 `demoNow(db)` 无漂移 | 真实环境用 wall-clock 时可能差几毫秒 | Mavis | 接入真实模型时同步校验 |
| `getAgentSchemas` 返回的 schema 实例与常量解耦 | schemaByMode 是闭包内 `Record` 外部不可 mutate | 重构时可能漂移 | Mavis | 重构 schema 工厂时 |

> 注：表中前 4 项沿用 `docs/test-scope.md` §4 既有排除（项目级一致），其余为本轮 scope 决定新增；**未决项与 §1.3 联动**。

---

## 6. 用例与追踪矩阵

### 6.1 覆盖矩阵（需求 → 风险 → NFR 域 → 用例占位 → CP → 阈值状态）

> scope_only 模式：场景/用例 ID 留 `TC-NFR-<DOMAIN>-<NNN>` 占位，**不展开**；下一步 representative_cases 才填具体 ID 与 Oracle

| 需求 / 评审发现 | 影响对象 | 风险 | NFR 域 | 场景 / 用例 ID（占位） | case_priority | 阈值状态 |
| --- | --- | --- | --- | --- | ---: | --- |
| 评审 7-29：异常路径错误高发（PROFILE-TYPE / HANDOFF-CONTRACT / IMPORT-XLSX） | 全部 Agent 模式 + 官网接口 | 异常路径无降级兜底 | 韧性 / 降级 | `TC-NFR-RESILIENCE-001..00N` | CP0 | UNAPPROVED |
| 评审 7-29：Agent 越权与 Prompt 注入（`core-regression.json` 仅 HANDOFF-009 一条） | 5 mode | Prompt 注入 / 越狱 / 工具权限绕过 | 安全 | `TC-NFR-SECURITY-001..00N` | CP0 | UNAPPROVED |
| 评审 7-29：handoff 空 product_code / 字符串 vs 对象双兼容 | `handoff_summary` mode | 结构漂移触发下游错误消费 | 数据完整性 | `TC-NFR-DATA-001..00N` | CP0 | spec_default 草案 |
| 评审 8-05：推荐引擎封顶 98 / 空表 / 并列排序边界 | `recommendProducts` | 公开可见规则争议 | 数据完整性 / 性能 | `TC-NFR-DATA-00N` | CP0 | spec_default 草案 |
| 评审 8-07：applyAgentResult 副作用（accepted 保护 / BY004 拒绝 / missing_contact） | 全部 Agent 模式 | 静默走错合同 | 数据完整性 | `TC-NFR-DATA-00N` | CP0 | spec_default 草案 |
| 评审 8-07：buildTargetContext 5 mode 合同 | 全部 Agent 任务 | 改任一 mode 静默走错 | 可观测 | `TC-NFR-OBSERV-001..00N` | CP1 | spec_default 草案 |
| 现有 NFR：state 100ms / action 200ms / xlsx 5s / task 50ms | 关键路径 | 单点不足以描述演示流畅 | 性能 | `TC-NFR-PERF-001..00N` | CP0 | UNAPPROVED |
| 现有 NFR：错误响应结构 / 任务 step 留痕 | 全部 API + Agent 任务 | 监控告警路由缺位 | 可观测 | `TC-NFR-OBSERV-00N` | CP0 | spec_default 草案 |
| 现有 NFR：xlsx 5MB / SQL 注入 / 白名单 / contact 状态机 | import + 官网 + demo | 纵深防御缺位 | 安全 | `TC-NFR-SECURITY-00N` | CP0 | spec_default 草案 |
| 现有 NFR：事务成功路径 / 重置 / 33 封顶 | demo_reset / applyAgentResult / sync_wca | 失败回滚未覆盖 | 韧性 | `TC-NFR-RESILIENCE-00N` | CP0 | spec_default 草案 |
| 接入真实模型前的 NFR 准备 | 评测 reporter + baselines | 接入即撞 NFR 缺位 | 通用 | （移交 `agent-nondeterministic-evaluator`） | CP0 | UNAPPROVED |
| NFR 排除项重新评估机制 | 流程 | 长期遗漏 | 流程 | （移交流程 + 文档） | CP0 | UNAPPROVED |

### 6.2 用例统计

| 维度 | 基线（2026-08-07） | 本次（scope_only） | representative_cases 预估 | baseline_ready 预估 |
| --- | ---: | ---: | ---: | ---: |
| NFR 用例数 | 16 | 0（scope_only） | **+30~50**（不重叠） | **+60~100**（含重复采样与人工抽检） |
| NFR 域覆盖 | 4 / 9 | 0 / 9（只标缺口） | **7 / 9**（加 可用性 / 可观测 / 数据完整性） | **9 / 9**（加 成本 + 兼容重评） |
| 全量测试文件 | 24 + 5 + 1 = 30 | 0 | +1~2（NFR 扩 / NFR-resilience / NFR-security） | +2~3 |
| 全量耗时 | 28.58s | 0 | +5~10s | +10~20s |

> 注：具体数量 representative_cases 阶段确定；本表仅为决策参考。

### 6.3 用例库 / 版本

- 用例库：`tests/integration/nfr-evidence.test.ts`（现有 16 用例）→ 扩 + 新建 `nfr-resilience.test.ts` / `nfr-security.test.ts` / `nfr-observ.test.ts`
- 版本来源：scope_only 本轮不写用例；下一步 representative_cases 阶段冻结版本号（建议 v1.0-NFR，与 8-05/8-07 一致）
- 历史保留：现有 16 NFR 用例在 git 历史可回溯
- 单一事实源：本决定 + `docs/test-scope.md` §3 NFR 子表

---

## 7. 移交

| 移交对象 | 内容 | 状态 |
| --- | --- | --- |
| `test-process-governor` | 阶段台账条目（待 representative_cases 阶段落 `docs/test-process.md` §1 / §7） | DRAFT |
| `test-tool-governor` | 本轮选型决策（仅 vitest + Node 内置 API；零新工具） | ✓ |
| `agent-nondeterministic-evaluator` | "接入真实模型前的 NFR 准备"移交（含评测执行框架 / 基线生成 / 在线监控 / 人工抽检） | NFR-SCOPE → EVAL 移交 |
| `release-regression-gatekeeper` | 性能 / 可观测 / 安全 / 韧性 4 类证据（见 test-pipeline.md §3.4）→ 本轮扩 `nfr-evidence.test.ts` 后 4 域证据将更完整 | DRAFT |

---

## 8. 评审状态

| 评审角色 | 结论 | 备注 |
| --- | --- | --- |
| 产品 | **PENDING** | §1.3 第 2 / 3 / 5 项需产品对 PoC 范围决策 |
| 研发 | 自审 | 提交者 Mavis（agent） |
| 测试 | 自审 | 同上 |
| 运维 / SRE | **PENDING** | §1.3 第 1 / 5 项阈值需 SRE 签字 |
| 安全 | **PENDING** | §1.3 第 3 项安全纵深优先级需安全签字 |

> **三方评审尚未发生**：本决定为 agent 单方面 scope_only 草案，遵循 case-design.md §"评审与维护"约定的最低标准（自审 + 提交入库），**不能标 APPROVED**。下一步 representative_cases 模式必须先关闭 §1.3 全部未决项。

### 8.1 未决问题与下一步

| # | 项 | 责任人 | 期限 | 影响 |
| --- | --- | --- | --- | --- |
| 1 | NFR 阈值 project_approved 签字 | 产品 + 研发 + SRE | representative_cases 启动前 | 阻塞代表用例的"阈值门禁" |
| 2 | 韧性/降级路径是否纳入 PoC | 用户 | representative_cases 启动前 | 决定 TC-NFR-RESILIENCE 用例规模 |
| 3 | 安全纵深（XSS / CSRF / 越权 / 脱敏）优先级 | 产品 + 安全 | representative_cases 启动前 | 决定 TC-NFR-SECURITY 用例规模 |
| 4 | 用户旅程级端到端性能范围（全 6 段 vs Agent 3 段） | 产品 | representative_cases 启动前 | 决定 TC-NFR-PERF 用例规模 |
| 5 | NFR 排除项重新评估机制 owner | 用户 | 本决定批准后 7 天内 | 决定 §5 重新评估条件列是否启动 |
| 6 | 三方评审（产品 / 研发 / 测试 / SRE / 安全） | PR review | representative_cases 提交时 | 决定 scope_status → APPROVED |

---

## 9. 命令记录（可复跑）

```powershell
# 1) 现有 NFR 证据基线（不动）
node node_modules/vitest/vitest.mjs run tests/integration/nfr-evidence.test.ts --reporter=verbose
# → 16 passed (~2s)（基线已通过，scope_only 模式不动）

# 2) Agent 评测集结构护栏（不涉及 Agent 改动，但仍要复跑确认）
node scripts/agent-eval-report.mjs --check
# → exit 0（100 用例 / 5 mode / 9 阈值 / ID 唯一）

# 3) 全量回归（确认 scope_only 模式零回归）
node node_modules/vitest/vitest.mjs run --reporter=dot
# → 30 files / 482 tests / ~29s / 0 failures

# 4) 文档索引更新（docs/INDEX.md §4 活动目录登记）
# 建议动作：把 docs/history/2026-08-11-nfr-scope/ 加入 §4 历史目录索引
```

---

## 10. 质量自检（按用户"完成后检查生成质量"要求 + 7-29 经验教训）

| 检查项 | 结果 |
| --- | --- |
| scope_only 模式只出范围结论 / 不展开可执行用例 | ✅ 用例 ID 全部为 `TC-NFR-<DOMAIN>-<NNN>` 占位；具体 Oracle 留 representative_cases 阶段 |
| NFR 判据（阈值）必须标 source_layer + 批准状态 | ✅ 全文用 spec_default / UNAPPROVED / UNKNOWN；未发明任何 project_approved 数字 |
| NFR 域覆盖齐全（9 域） | ✅ §3 表覆盖全部 9 域；标注当前用例数 / 覆盖深度 / 主要缺口 |
| 来源 → 风险 → 指标/判据 → 负载或故障模型 → 场景 → 证据 链路 | ✅ §6.1 覆盖矩阵按此结构展开；负载/故障模型留 representative_cases 阶段填具体 |
| 用例压缩：参数化用例 vs 独立用例 | scope_only 不展开；representative_cases 阶段按 case-design.md §"用例压缩与展开规则"处理 |
| 评审状态不伪造 | ✅ 标 DRAFT / PENDING / 自审；未声称 APPROVED |
| 排除项写明原因 / 风险所有者 / 重新评估条件 | ✅ §5 全部三列齐全；与 test-scope.md §4 既有排除项联动 |
| 跨技能交接包字段完整 | ✅ §7 含 4 个 skill 移交；handoff_packet 字段按 case-design.md §"跨技能交接包" |
| 与 7-29 教训对齐：不再"看起来合理"地推断 | ✅ 全部数字（16 / 482 / 100 / 24+5+1）来自既有报告与 `Get-ChildItem` 实际计数；§3 NFR 缺口从 nfr-evidence.test.ts 实际内容 + 5 skills nfr-design.md 9 域清单推导 |
| 与 8-05/8-07 经验对齐：用例 ID / CP 标签 / 评审状态约定 | ✅ 复用其模板；`case_priority` 列与历史一致 |
| 数字是否实测 | ✅ 16 / 482 / 100 / 24+5+1 = 30 / 28.58s 全部来自既有记录；预估数量明确标"representative_cases 阶段确定" |
| 不修改演示数据库 / 不修改 .env / 不修改 nuxt.config.ts | ✅ 业务代码 / 配置变更 = 无 |
| 不引入新工具 | ✅ 仍只用 vitest + Node 内置 API；按 test-tool.md §10 "NFR 工具缺失"治理 |

---

**维护**：Mavis · **审核**：产品 / 研发 / SRE / 安全（PR review 触发） · **下次复盘**：representative_cases 提交时同步关闭 §1.3 全部未决项
