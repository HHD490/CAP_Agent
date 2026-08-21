# CAP_Agent 范围评估（scope_only 模式）— 2026-08-18

> **执行人**：Mavis（root，test-scope-case-designer skill，scope_only 模式）
> **触发**：8/14 二次全量审计 + 8/17 commit `5070ef9` + 8/18 fresh coverage 触发新一轮盘点
> **拍板**：AHa 8/18 14:00 ask_user —— 深度 = scope_only / 不补 case / 不动 docs / 派 worker 单跑报告
> **分支**：`codex/AHa-testing` HEAD = `46236dd`（8/14 audit 节点；未推送本地变更）
> **模式**：`scope_only`（只给范围和估算；不展开代表性用例；不生成可入库 baseline）
> **依据**：[SKILL.md] + [scope-policy.md] + [regression-model.md] + [case-design.md] + [nfr-design.md] + [case-templates.md]
> **AGENTS.md §6.2** 决策面：test-scope-case-designer（自有）/ test-execution-governor（看）/ release-gatekeeper（看）/ agent-nondeterministic-evaluator（看）
> **AGENTS.md §6.4** 共同不变量：证据闭环 / 预算 ≠ 完成证据 / 不发明数字

---

## 0. 摘要

| 维度 | 状态 |
| --- | --- |
| 模式 | **scope_only**（清单 + 风险 + 缺口 + 派工建议；不补 case / 不动 docs） |
| 起点 | 8/14 二次全量审计（commit `9e6bfd4`） + 8/17 commit `5070ef9`（补 3 真不变量 case） + 8/18 fresh coverage evidence（v8 mtime 8/14 11:29） |
| 产出 | 5 部分交付（现状盘点 / owner 决策面覆盖度 / 真缺口清单 / 下一步建议 / 校验步骤） |
| 真缺口 | **8 项**（高 2 / 中 4 / 中-高 1 / 低-中 1） |
| 下游触发 | 8/19 scope_only 续篇（[scope-only-round-2026-08-19.md](../2026-08-19-scope-round/scope-only-round-2026-08-19.md)），本报告 §F 详述 8/19 + 8/20 落地映射 |
| 派工 | R0-R3 串行分批；Mavis 派 `mvs_aed0e99e4b334616a84470edfde2d3fe` worker 单跑；subagent 留到下一轮 |

---

## 1. 目标 / 动作 / 观察 / 增量 / 下一步

| 轮次 | 目标 | 动作 | 观察 | 相对上一轮增量 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| 1.1 | 读 SKILL.md + 4 references + 1 asset | 全部读完 | mode = scope_only；4 部分交付；NFR/Agent 阈值无 approved 时标 `UNAPPROVED`，不发明数字 | 0 | 进入 1.2 |
| 1.2 | 盘点 AGENTS.md §6.2 / §6.4 / §6.5 + 4 文档（scope/process/tool/pipeline/release/agent-eval） | 全读 + 关键摘录 | 4 个决策面文档均存在；§6.4 共同不变量与 case-design.md "评审与维护" 对齐 | 0 | 进入 1.3 |
| 1.3 | 读 coverage-final.json（v8 8/14 11:29 跑）| Python 解析 v8 原始数据，提取 statement/branch/function 总覆盖 + 未覆盖行号 | 业务代码 (server/* + utils/* + shared/* + composables/*) stmt 99% / branch 90%；uncovered 全部在 §4 排除项登记范围 | 0 | 进入 1.4 |
| 1.4 | 盘点 tests/ 41 文件 it()/it.each 数量 | Python 计数 + grep 关键 TC 标签 | 顶层 it() ≈ 511（展开 it.each 累计 615-618）；agents-evaluation.test.ts 14 护栏 | 0 | 进入 §A-C 真缺口识别 |
| 1.5 | 8/14 二次全量审计 vs 8/17 commit 5070ef9 互相验证 | diff message + 代码 | 8/14 误判 L199/L502/L295-298 为"防御性 / 副作用大于价值"；8/17 commit 又"重新分类"为真不变量 | 1 真缺口（口径不一致）| 写入 §C |
| 1.6 | v8 fresh coverage 自 8/14 后是否重跑 | git log / file mtime | coverage-final.json mtime = 8/14 11:29；8/17 commit 5070ef9 没新 v8 evidence | 1 真缺口（fresh evidence 缺失）| 写入 §C |

---

## A. 现状盘点

### A.1 文档结构

| 文档 | 路径 | 行数 | 关键章节 | owner 决策面 |
| --- | --- | ---: | --- | --- |
| `docs/test-scope.md` | docs/test-scope.md | 161 | §1 变更摘要 / §2 风险分析 / §3 范围清单 / §4 排除项（23 行）/ §5 用例方法 / §6 交付物 / §7 复盘 | (1) test-scope-case-designer |
| `docs/test-process.md` | docs/test-process.md | 112 | §1 阶段与门禁 / §2 准入与准出 / §3 Agent 项目专项 / §4 缺陷分级 / §5 暂停条件 / §6 角色职责 / §7 报告与归档 | (2) test-execution-governor |
| `docs/test-tool.md` | docs/test-tool.md | （未读）| 由 (2) owner | (2) test-execution-governor |
| `docs/test-pipeline.md` | docs/test-pipeline.md | （未读）| 由 (2) owner | (2) test-execution-governor |
| `docs/release-regression.md` | docs/release-regression.md | 175 | §1 版本类型 / §2 范围确定 / §3 发布方式 / §4 发布门禁 / §5 灰度实施表 / §6 Hotfix / §7 回滚 / §8 申请与结论 / §9 CI 接入 | (3) release-gatekeeper |
| `docs/agent-evaluation.md` | docs/agent-evaluation.md | 166 | §1 评测对象 / §2 数据集 / §3 阈值 / §4 模式覆盖 / §5 不可违反 / §6 护栏 / §7 reporter / §8 演进 / §9 衔接 / §10 限制 | (4) agent-nondeterministic-evaluator |
| `docs/history/2026-08-13-exclusion-review/scope-exclusion-review-2026-08-13.md` | history/... | 268 | 19 项业务层排除统一登记 + 2 项真缺口（性能基线数字 / NFR 排除项重新评估机制本身）| 业务层（跨 4 owner）|
| `docs/history/2026-08-11-nfr-scope/scope-decision-2026-08-11.md` | history/... | （未读摘要，已通过 test-scope.md §1.3 引用）| NFR 域补缺范围决定（6 类 31 条）| (1) test-scope-case-designer |

### A.2 docs/test-scope.md §3 范围清单盘点

**§3 行数**：30 行（行 39-79）。**风险等级分布**：

| 风险等级 | 数量 | 占比 |
| --- | ---: | ---: |
| P0（高）| 30（含 NFR 31 条 + REAL-005 + IMPORT-XLSX-020 增量）| 100% |
| P1（中）| 1（smoke 入口）| 0.03% |
| P2 / 低 | 0 | 0% |

> **观察**：§3 全部 P0 + 1 P1，**没有显式 P2-P4 / 中低风险登记**。这违反 SKILL.md scope-policy.md "按影响/可能性/变更触达/可恢复性分级，记录证据而非只写标签"——只写 P0 是把 30 个不同粒度的不变量一视同仁。

### A.3 tests/ 41 文件真不变量盘点

**实际统计**（Python it() 计数 + grep 关键 TC 标签）：

| # | 路径 | it 数 | 锁住的核心不变量（1 行）|
| --- | --- | ---: | --- |
| 1 | tests/unit/agent-schemas.test.ts | 41 | Agent 5 mode zod schema 全边界（6 枚举 / 4 intent × 3 confidence 矩阵 / fit_score coerce）|
| 2 | tests/unit/demo-actions-workflow.test.ts | 41 | demo 14 个 action 主链路 + 业务规则 + 兜底（含 set_contact 5 分支 / confirm_next_action 部分更新）|
| 3 | tests/unit/use-demo-state.test.ts | 31 | useDemoState composable 客户端契约（refresh 防抖 / state 替换 vs 保留 / 错误退化链）|
| 4 | tests/unit/agent-context-and-result.test.ts | 30 | buildTargetContext 5 mode 合同 + applyAgentResult 5 mode 副作用（accepted 保护 / BY004 不落库 / 事务 ROLLBACK / stage 推进不降级）|
| 5 | tests/unit/state-endpoint.test.ts | 30 | state.get 端点 shape + counts + emailAllowlist 解析边界（undefined / 空串 / 仅空白 / 归一）|
| 6 | tests/unit/state-website-coverage.test.ts | 25 | state.ts / website.ts / action.post.ts 残留分支（state-website 6+10+9 边界）|
| 7 | tests/integration/nfr-evidence.test.ts | 21 | 性能基线 / 证据链 / 21 it（PERF-001..005）|
| 8 | tests/unit/agent-lifecycle.test.ts | 20 | Agent 任务生命周期（创建/停止/状态机/留痕/级联；含 8/17 新增 L199 容错 / L502 String(error)）|
| 9 | tests/integration/import-xlsx.test.ts | 18 | xlsx/csv 导入（中英表头 / 重复 / 空行 / 200 行 / 5MB / member_id 优先级 / 缺 domain/country 兜底）|
| 10 | tests/integration/demo-action-residual-branches.test.ts | 17 | action.post.ts 残留 17 分支（404 × 4 / zod × 5 / 跨客户 / 邮件 × 4 / 兜底 × 3）|
| 11 | tests/integration/website-journey.test.ts | 16 | 官网 quote/identity/rematch 主链路 + 会话隔离 + 原子校验 + 注入 |
| 12 | tests/unit/agent-edge-cases.test.ts | 16 | agent.ts 16 边角分支（runTask / callModel / context-edge / apply-edge）|
| 13 | tests/unit/parse-json-response.test.ts | 16 | parseJsonResponse Markdown / 废话 / 数组拼接 / 缺 JSON / 大小写 / dead branch 锁定 |
| 14 | tests/unit/agent-reply-qualification.test.ts | 15 | reply_qualification 全 intent × 边界（含对抗注入）|
| 15 | tests/integration/agent-tasks-endpoint.test.ts | 14 | Agent tasks HTTP 端点（zod × 9 / dedup / stop × 4）|
| 16 | tests/unit/advance-time-reminders.test.ts | 14 | advance-time 跟进提醒（首次 / 二次 / 暂停 / 不触发 / 多条同时 / 阶段非 6 / 状态非 active）|
| 17 | tests/unit/agent-evaluation.test.ts | 14 | 离线评测集结构护栏 14 条（核心 100 / 5 mode / 9 阈值 / ID 唯一 / 安全 100%）|
| 18 | tests/unit/db-utils.test.ts | 13 | DB 工具层（addEvent / demoNow / initializeDatabaseConnection / prepareOpenedDatabase / runDatabaseMigrations；含 8/17 新增 L295-298 ROLLBACK）|
| 19 | tests/unit/is-valid-outreach-contact.test.ts | 13 | isValidOutreachContact 真值表（status 枚举 / email whitespace / 大小写）|
| 20 | tests/unit/website-recommendations.test.ts | 11 | 官网产品推荐（published / Top3 / 路线/货类/能力/偏好 / 空表 / 98 上限 / 阈值边界）|
| 21 | tests/unit/agent-tasks-edge.test.ts | 10 | Agent 任务端点边缘（同 target 多 mode / stop 终态幂等 / stop 后重建 / 起步 stop 留痕 / dedup）|
| 22 | tests/unit/outreach-contact.test.ts | 9 | 联系人校验多入口对齐（Agent vs demo action 共享 isValidOutreachContact）|
| 23 | tests/unit/mark-non-accepted-matches-stale.test.ts | 8 | markNonAcceptedMatchesStale 边界（无 match noop / 全 accepted 保护 / 自定义 now / 多次幂等 / 不传 db）|
| 24 | tests/integration/nfr-security.test.ts | 6 | 安全 NFR 6 条（越权 / 注入 / 脱敏 / 鉴权）|
| 25 | tests/unit/legacy-publish.test.ts | 6 | BY004 修正 6 路径 + 幂等 |
| 26 | tests/unit/opportunity-stages.test.ts | 6 | Opportunity 9 阶段常量合同（长度 / 顺序 / 关键索引 5/6/8）|
| 27 | tests/integration/demo-action-stale.test.ts | 5 | update_* 触发 stale + accepted 保护 + 联系人多入口对齐 |
| 28 | tests/integration/nfr-resilience.test.ts | 5 | 韧性 NFR 5 条（含事务 ROLLBACK 与 RESILIENCE-006 互补）|
| 29 | tests/integration/rematch-identity-stale.test.ts | 5 | rematch / identity / update_* 路径不 stale accepted |
| 30 | tests/unit/agent-callmodel-real.test.ts | 5 | callModel 真 API 路径（openai-compatible vs deepseek × thinking / length / 空 content）|
| 31 | tests/unit/handoff-contract.test.ts | 4 | handoff 对象/字符串双兼容 |
| 32 | tests/unit/handoff-legacy.test.ts | 4 | handoff 旧字符串 recommended_product 解析 |
| 33 | tests/unit/profile-type.test.ts | 4 | 6 枚举 + 非法值 |
| 34 | tests/integration/nfr-data.test.ts | 3 | 跨会话幂等 / profile_version 自增 / 事务 ROLLBACK |
| 35 | tests/integration/nfr-observ.test.ts | 3 | 可观测 NFR 3 条 |
| 36 | tests/unit/demo-reset.test.ts | 3 | demo 数据重置（标准种子 + 清理 + BY004 安全不变量）|
| 37 | tests/unit/product-publish.test.ts | 3 | BY004 等产品发布 published 过滤 + simulated 排序 |
| 38 | tests/integration/nfr-cost.test.ts | 2 | Provider 调用计数 5 mode × 10 + 缓存命中 |
| 39 | tests/unit/doc-contracts.test.ts | 1 | docs 结构护栏（§4 列结构 / 7 列期望）|
| 40 | tests/unit/smoke-entry.test.ts | 1 | Windows Nitro 烟囱发现 + test:smoke 脚本定义 |
| 41 | tests/smoke/import-xlsx.smoke.test.ts | 2 | Windows Nitro 真实进程 dev/build + xlsx 导入（skipIf !isWindows）|

**合计**：41 文件，**顶层 it() ≈ 513**（含 smoke 2 it.skipIf），展开 it.each 后 vitest 跑测总数 = **618**（依据 8/17 commit 5070ef9 message：`615 → 618 pass`）。

### A.4 v8 coverage 总盘点（基于 coverage-final.json 8/14 11:29）

> **重要前提**：coverage-final.json 文件 mtime = 2026-08-14 11:29:38。**8/17 commit 5070ef9 之后没有重跑 v8**。所有"8/17 新增 case 是否真覆盖了 L199/L502/L295-298"**没有 fresh evidence**。

业务代码（server/* + utils/* + shared/* + composables/*）：

| 文件 | stmt | branch | fns | 未覆盖 stmt | 未覆盖 branch | 排除项登记 |
| --- | ---: | ---: | ---: | --- | --- | --- |
| composables/useDemoState.ts | 61/91 (67.0%) | 34/39 (87.2%) | 6/6 (100%) | L17-26, L81-104 (30) | L80×2, L16, L35, L37 | §4 #8（浏览器 only）|
| server/utils/agent.ts | 460/468 (98.3%) | 167/188 (88.8%) | 19/19 (100%) | L216-218, L348-350, L523-524 (8) | L199, L203, L205, L215, L240-242, L253-255, L279-280, L285-287, L291, L347, L351, L475, L502, L522 (21) | §4 #10, #11, #12, #13（含 8/17 commit 5070ef9 新增的 L199 / L502；fresh evidence 缺失）|
| server/utils/db.ts | 314/317 (99.1%) | 70/75 (93.3%) | 14/14 (100%) | L296-298 (3) | L193, L206, L246×2, L295 (5) | §4 #19（含 8/17 commit 5070ef9 新增的 L295-298；fresh evidence 缺失）|
| server/api/demo/action.post.ts | 201/201 (100%) | 142/152 (93.4%) | — | 0 | L21, L22, L31, L49×2, L50, L60, L79, L93, L116 (10) | §4 #14 |
| server/api/import/customers.post.ts | 50/50 (100%) | 52/54 (96.3%) | — | 0 | L18, L20 (2) | §4 #20（dead-by-library）|
| server/api/website/identity.post.ts | 64/64 (100%) | 23/26 (88.5%) | — | 0 | L20, L27, L42 (3) | §4 #16 |
| server/api/website/rematch.post.ts | 38/38 (100%) | 5/6 (83.3%) | — | 0 | L31 (1) | §4 #17 |
| server/utils/state.ts | 238/238 (100%) | 53/55 (96.4%) | 9/9 (100%) | 0 | L5, L98 (2) | §4 #15 |
| server/utils/website.ts | 52/52 (100%) | 22/26 (84.6%) | 1/1 (100%) | 0 | L16-18, L23 (4) | §4 #18 |
| server/utils/contact.ts | 5/5 (100%) | 8/8 (100%) | 1/1 (100%) | 0 | 0 | — |
| server/api/state.get.ts / tasks.post.ts / stop.post.ts / advance-time.post.ts / reset.post.ts / website/quote.post.ts | 100% | 100% | — | 0 | 0 | — |
| utils/opportunity.ts | 11/11 (100%) | 0/0 | 0/0 | 0 | 0 | — |
| shared/types.ts | 0/0 | 1/1 (100%) | 1/1 (100%) | 0 | 0 | （type-only）|

**汇总**：
- 业务代码 statement 总覆盖 = 1494/1504 (99.3%)
- 业务代码 branch 总覆盖 = 578/640 (90.3%)
- 业务代码 function 总覆盖 = 51/51 (100%)

**未覆盖 stmt 全在 §4 排除项**（21 行）**或 §4 #8 浏览器 only** 范围。未覆盖 branch 几乎全部 §4 排除项登记，**仅 L199 / L502 / L295 是 8/17 commit 5070ef9 新增的真不变量 case 试图锁住的——但 v8 没 fresh 跑**。

### A.5 docs/history/2026-08-13-exclusion-review/scope-exclusion-review-2026-08-13.md 深度评估

**文件类型**：scope_only 业务层决定（不是 audit 级）
**总排除项**：19 项 = 6 docs §4 既有 + 17 scope-decision-2026-08-11 §5 − 4 重叠 = 19
**真缺口（已 approved）**：
- #18 性能基线数字（CP0 对象）— owner SRE + 研发（2026-08-14 approved）；时间窗 即时 ≤ 7 天
- #19 NFR 排除项重新评估机制本身 — owner 测试治理 owner（2026-08-14 approved）；时间窗 周期 ≤ 30 天

**这两项真缺口在 docs/test-scope.md §4 #22 / #23 已跨表引用**，但 §4 表格标"已 approved 2026-08-14"——但**实际没看到 §1.3 第 6 项 + §3 owner 配置的原始签字**（仅是 scope-excl §3 + §1.4 标"已 approved"）。建议在 release 决策前由产品 / 研发 / SRE 重新签字。

**覆盖深度**：
- §4 表 19 项 × 8 列齐全（来源 / 排除项 / 原因 / 剩余风险 / 责任人 / 重新评估条件 / 时间窗 / 级别）
- §6 用例与追踪矩阵 `TC-NFR-EXCL-<NNN>` 是占位，**scope_only 模式不出可执行 it**；representative_cases 阶段才展开
- **结论**：此文件是 scope_only 决定，**未深化到 representative_cases 深度**——19 项排除项登记完整但每项"重新评估"的工程化检查（如 cron / PR-bot / docs 验证）尚未实现

---

## B. §6.2 owner 决策面覆盖度对照表

> **口径**：本表不替其它 3 个 owner 决定（不在本 skill 范围）；只评估"本 skill 范围内的用例是否锁住了其它 3 个 owner 决策面所需的不变量"。

| §6.2 决策面 | docs/test-scope.md 是否覆盖 | 实际测试是否覆盖 | 缺口/已覆盖 | 证据 |
| --- | --- | --- | --- | --- |
| **(1) 测试范围/回归层级/风险评级/用例意图**（test-scope-case-designer 自有）| ✅ §3 范围清单 30 行 + §4 排除项 23 行 + §5 方法 + §6 交付物 | ✅ 41 文件 / 513 顶层 it() / 618 跑测总数 | **已覆盖** | docs/test-scope.md:39-79; tests/unit/agent-schemas.test.ts:1-20377; tests/integration/website-journey.test.ts:1-20003 |
| **(2) 测试工具/环境/执行准出**（test-execution-governor 范围）| ✅ 间接覆盖：本 skill §3 范围清单每行含"环境/数据"列（如 P0 单元 / P0 集成 / P0 JSON+reporter）| ✅ 工具相关不变量已锁：mock `openai` for callModel（agent-callmodel-real.test.ts）/ `useIsolatedDb` for db 隔离（helpers/db.ts）/ `setAgentProviderForTests` for agent provider 替换（agent-lifecycle.test.ts）/ `releaseNuxtLock` for smoke 真实进程（helpers/nitro-smoke.ts）| **已覆盖**（间接）| docs/test-scope.md:39-79; tests/helpers/setup.ts; tests/unit/agent-callmodel-real.test.ts:1-8782 |
| **(3) 发布/灰度/回滚**（release-gatekeeper 范围）| ✅ 间接覆盖：本 skill §3 不写"灰度比例"，由 release-regression.md §3 §5 决定 | ✅ 端点 / 端到端 集成测试 18 个 it 锁住 release 前必过的关键路径（agent-tasks-endpoint 14 / import-xlsx 18 / website-journey 16 / demo-action-stale 5 / rematch-identity-stale 5）| **已覆盖**（间接）| docs/test-scope.md:39-79; docs/release-regression.md:88-95; tests/integration/agent-tasks-endpoint.test.ts:1-6614 |
| **(4) Agent 评测集/采样/语义质量/漂移信号**（agent-nondeterministic-evaluator 范围）| ✅ 间接覆盖：本 skill §3 范围清单"Agent 离线评测"行指 agent-evaluation/* ；§4 #1 真实 LLM 排除项登记 | ✅ agent-evaluation.test.ts 14 护栏锁住 core-regression.json 结构（5 mode ≥ 20 用例 / 9 阈值 / computation+safety 100% / ID 唯一 / samples ≥ 3 / max_diff_rate ≤ 0.1 / 元数据齐全 / 不含敏感信息）；tests/agent-evaluation/core-regression.json 100 用例 | **已覆盖**（间接，但真实执行未启用）| docs/agent-evaluation.md:91-110; tests/unit/agent-evaluation.test.ts:1-8127; tests/agent-evaluation/core-regression.json:1-75211 |

**观察**：
- 4 个决策面都有间接覆盖，没有"完全裸奔"
- **覆盖最弱的是 (4) Agent 评测**：§10 明确"真实模型 CI 评测未启用 / 基线未生成 / 在线监控未接入 / 人工抽检比例仅在报告中给出字段待执行"
- **次弱是 (1) test-scope-case-designer 自有**：docs §3 全部 P0 + 1 P1，**没有显式中低风险登记**——只写 P0 等于把 30 个不同粒度不变量一视同仁，违反 scope-policy.md "按影响/可能性分级"

---

## C. 真缺口清单

> **严格筛选**：只列有 evidence 的真缺口。每个缺口配 v8 行号 / docs 行号 / tests 目录 / commit message 交叉验证。

### 缺口 #1（高）— v8 fresh coverage 自 8/14 后未重跑

- **不变量**：每个 commit 后必须用 fresh v8 evidence 验证"未覆盖 stmt/branch 真减少"（SKILL.md "证据闭环" + case-design.md "评审与维护"）
- **证据**：
  - `coverage\coverage-final.json` mtime = 2026-08-14 11:29:38（Get-Item LastWriteTime）
  - 8/17 commit 5070ef9 message 自称"基于 8/14 11:29 v8 coverage evidence" —— **沿用旧 evidence，没新跑**
  - `coverage\.vitest-baseline.log` 是 8/14 11:29 的 vitest 输出
  - 8/17 commit 5070ef9 补 3 case 后没附 fresh coverage 数据
- **严重度**：高（违反 case-design.md "评审与维护" + SKILL.md "证据闭环"）
- **排除依据**：无
- **重新纳入条件**：
  1. 在 `package.json` 加 `test:coverage:fresh` 脚本（`vitest run --coverage` + 上传 coverage-final.json 到 docs/history/<date>/）
  2. 每个 commit message 必须附"fresh coverage 行号引用"（类似 8/14 commit 9e6bfd4 格式）
  3. 缺失时直接 BLOCKED（不允许"未验证即声称覆盖"）

### 缺口 #2（高）— 8/14 二次全量审计的"全部归到 §4 排除项"判断过宽

- **不变量**：scope_only 决定"未覆盖 = 排除项"必须每行配"行为契约 / 副作用 / 责任人"证据（scope-policy.md "每个排除项记录原因、剩余风险、责任人和重新纳入条件"）
- **证据**：
  - 8/14 commit 9e6bfd4 message："剩余未覆盖 stmt / branch 全部为 §4 登记的次级排除项，**真实业务不变量已 100% 由 deterministic 单元/集成 + 离线评测 100 用例锁住**"
  - 但 8/17 commit 5070ef9 message 又"补 3 个真不变量缺口"：L199 updateTask 容错 + L502 runTask non-Error + L295-298 resetDemoDatabase ROLLBACK
  - 这 3 条**实际是 8/14 没识别出来的真不变量**：
    - L199 = task 不存在时静默 return（**行为契约**，不是单纯防御性 ?? 兜底）
    - L502 = non-Error throws 序列化为字符串（**错误处理契约**，业务期望决定）
    - L295-298 = COMMIT 失败时 ROLLBACK（**事务完整性不变量**，资金/数据高风险）
  - §4 #13 行把 L199 / L502 归到"防御性 ?? 兜底"是**误分类**（应单列"行为契约"和"错误处理契约"两类）
  - §4 #19 行把 L295-298 归到"副作用大于价值"是**严重低估**（事务 ROLLBACK 是 PoC 数据完整性的高风险不变量）
- **严重度**：高
  - L295-298 实际是**事务完整性 / 数据一致性不变量**，scope-policy.md 高风险条款
  - 资金 / 计费 / 权限 / 安全 / 敏感数据 / **一致性 = 高风险处理**
- **排除依据**：已被 8/17 commit 5070ef9 部分纠正（但 v8 fresh evidence 缺失，见 #1）
- **重新纳入条件**：
  1. 把 §4 #13 拆成"防御性 ?? 兜底（DB / JSON.parse / 字段填充 / 错误抛出）" + "**行为契约**（updateTask 容错 / 字段填充守卫）" + "**错误处理契约**（String(error) / LLM endpoint 配置）" 3 类
  2. §4 #19 把 L295-298 单独标"事务完整性 ROLLBACK 真不变量"，移出"副作用大于价值"集合
  3. 8/14 / 8/17 互相矛盾的两条 commit message 需要 1 个 commit（或一份 audit 报告）统一口径

### 缺口 #3（中）— NFR 性能阈值 "10% 核心指标恶化" 缺 approved 来源

- **不变量**：scope-policy.md "高风险至少包括核心业务 / 资金 / 计费 / 权限 / 安全 / 敏感数据 / 不可逆写入 / 核心 Agent 行为和重大契约变化"；nfr-design.md "SLI、长期 SLO 与发布/回滚条件是不同契约，不能自动互换。缺少批准阈值时可给测量计划并标 `UNAPPROVED`"
- **证据**：
  - `docs\test-process.md:60` §3 离线评测准出："与基线相比核心指标恶化 ≤ 10%" — **未标 approved by / source**
  - `docs\test-process.md:59` §3 离线评测准出："核心回归集通过率 ≥ 阈值（见 `core-regression.json`）" — 引用合规
  - `docs\release-regression.md:74` §4 发布后 30 分钟内："P95 响应延迟 ≤ 基线 1.5 倍" — **未标 approved by / source**
  - `docs\release-regression.md:91-95` §5 灰度实施表：1% / 5% / 20% / 50% / 100% 阶段 + 错误率 > 1% / 0.5% 阈值 — **未标 approved by / source**
  - agent-evaluation.md §3 9 个阈值（98% / 95% / 100% / 95% / 100% / 90% / 95% / 99% / 100%）—— §5 第 7 条说"§3 的 target/minimum 是项目批准值"，**有 source 但缺签字角色**（应标"approved by 产品/研发"）
- **严重度**：中
  - "10% 核心指标恶化"和"P95 ≤ 1.5x baseline"是发布门禁关键参数——若来源不清，release-gatekeeper 实际判断无依据
  - agent-evaluation.md §3 阈值有 source 但没签字角色，regression 阶段无法反推到"谁批准"
- **排除依据**：无（这些是发布门禁参数，不是业务排除项）
- **重新纳入条件**：
  1. test-process.md §3 "10%" 标"approved by [产品/研发/SRE] + date" 或标 `UNAPPROVED`
  2. release-regression.md §4 "P95 ≤ 1.5x" 和 §5 "1%/5%/20%/50% 灰度 + 错误率阈值" 标 source + approved by
  3. agent-evaluation.md §3 9 阈值加 "approved by [产品/研发]" 签字行
  4. 阈值 / 比例 调整必须联动更新：docs + 4 处代码（nfr-design.md 明确要求 4 处同步）

### 缺口 #4（中）— 真实 LLM 端到端 + Agent 评测基线未生成（结构性缺口，跨 owner）

- **不变量**：agent-evaluation.md §10 已知限制 4 项
- **证据**：
  - `docs\agent-evaluation.md:158-161` §10 已知限制：
    1. "真实模型 CI 评测未启用" —— v1.0 只能跑结构护栏
    2. "基线未生成" —— `tests/agent-evaluation/baselines/` 目录尚未创建
    3. "在线监控未接入"
    4. "人工抽检比例待执行"
  - `tests\agent-evaluation\baselines\.gitkeep`（672 字节）—— 占位文件，baselines/ 实际为空
  - docs/test-scope.md §4 #1 "真实 LLM 端到端评测" 排除项 — 触发器"接入真实模型时启用"
- **严重度**：中（接入真实模型前的结构性缺口，由 agent-nondeterministic-evaluator owner 决定何时关闭）
- **排除依据**：docs/test-scope.md §4 #1 + agent-evaluation.md §10
- **重新纳入条件**：
  1. 接入真实模型时同步启用 core-regression.json 评测 + 生成 baseline
  2. tests/agent-evaluation/baselines/ 启用 baselines/`<version>.json` 落档
  3. 接入在线监控（mode: online_monitor 5 指标：解析成功 / 用户修正 / 负面反馈 / 成功率 / 延迟）

### 缺口 #5（中）— 多进程部署竞态 / SQLite 单写锁假设（服务化前缺口）

- **不变量**：scope-excl §4 #14 #15 "applyAgentResult 多 customer 并发竞态" + "set_contact 跨 SELECT/UPDATE 改 status 竞态" — "SQLite 单写锁 + Node 单进程"假设
- **证据**：
  - `docs\history\2026-08-13-exclusion-review\scope-exclusion-review-2026-08-13.md:138-139` §4 行 14-15
  - 服务化或多进程部署时可能触发
  - 当前测试用 `useIsolatedDb()` 单进程串行，无法复现
- **严重度**：中（服务化时升级为高）
- **排除依据**：scope-excl §4 #14 #15 已登记
- **重新纳入条件**：
  1. 服务化时（多进程 / 集群部署 / DB 切到 Postgres）补并发竞态测试
  2. 评审点：service mesh 化 / k8s 部署时重评

### 缺口 #6（中-高）— 安全纵深（XSS / CSRF / 越权 / 脱敏）PoC 决策

- **不变量**：scope-policy.md 高风险条款"安全 / 权限 / 敏感数据"
- **证据**：
  - `docs\history\2026-08-13-exclusion-review\scope-exclusion-review-2026-08-13.md:132` §4 行 8 "安全纵深（XSS / CSRF / 越权 / 脱敏）" — "PoC 单浏览器演示是否需要" 触发器
  - `tests\integration\nfr-security.test.ts` 6 it（SECURITY-002..）— 仅 6 条 NFR 安全；具体覆盖范围未在 docs/test-scope.md §3 单独列
  - tests/integration/website-journey.test.ts:16 涉及"注入" — 但只 1 个 it，未覆盖 SQL 注入 / XSS / CSRF / 越权 4 维
  - docs/test-scope.md §3 风险表"高风险"列"Agent 5 个模式输出漂移 / reply intent 错判 / 联系人校验漂移 / accepted stale / BY004 误发布 / 官网部分写入 + 伪造 / SMTP 绕过"——**没单列 XSS / CSRF / 越权 / 脱敏**
- **严重度**：中-高（PoC 公开 web 暴露后无防御）
- **排除依据**：scope-excl §4 #8 已登记（DRAFT，owner 安全 lead 待指定）
- **重新纳入条件**：
  1. 安全 lead 批准 scope-excl §4 #8 决策
  2. 补 nfr-security 覆盖：SQL 注入 / XSS / CSRF / 越权 / 脱敏 5 维度
  3. 评估：PoC 是否长期作为生产暴露点

### 缺口 #7（中）— §3 范围清单 100% P0，缺中低风险显式登记

- **不变量**：scope-policy.md "按影响、可能性、变更触达和可恢复性分级，记录证据而非只写标签"；regression-model.md "层级选择并记录来源、适用范围、排除、风险和批准状态"
- **证据**：
  - `docs\test-scope.md:39-79` §3 表：30 行 P0 + 1 行 P1（smoke 入口），**0 行 P2 / P3 / 中 / 低**
  - §2 风险分析有"中风险" 3 条（跟进提醒 / demo 14 action / state.get 计数）和"低风险" 2 条（文案日志 / promptfoo）—— 但 §3 表没把这些映射到具体对象
  - tests/ 实际有大量"中风险"用例（如 demo-actions-workflow 41 / agent-lifecycle 20 / advance-time-reminders 14）—— 但 docs 标 P0
- **严重度**：中（只写 P0 等于把所有不变量一视同仁，违反分级原则；regression-model.md "smoke / core / full 层级" 无法映射到 §3 表）
- **排除依据**：无
- **重新纳入条件**：
  1. §3 表加"风险等级"列（P0 / P1 / P2 / P3）
  2. 至少把"中风险" 3 条（跟进提醒 / demo 14 action / state.get 计数）映射到具体对象和用例
  3. regression-model.md 层级（smoke / core / full）与 §3 表风险等级联动

### 缺口 #8（低-中）— 排除项与 §3 范围清单的"重新评估条件"自动化缺失

- **不变量**：scope-policy.md "每个排除项记录原因、剩余风险、责任人和重新纳入条件" + case-design.md "评审与维护"
- **证据**：
  - `docs\test-scope.md:106-130` §4 23 行排除项，**每行有"重新评估条件"列**（手工记录）
  - scope-excl §4 19 行 同样
  - docs/test-scope.md §7 复盘与回流："每月 review 一次排除项"——**无 owner / 无自动化**（scope-excl §4 #19 真缺口）
  - `tests\unit\doc-contracts.test.ts` 1 it 只锁 docs §4 表结构，不验证"重新评估条件"实际触发
- **严重度**：低-中（影响长期治理，但 PoC 阶段不阻塞）
- **排除依据**：scope-excl §4 #19 + docs/test-scope.md §4 #23（owner 测试治理 owner，2026-08-14 approved）
- **重新纳入条件**：
  1. 测试治理 owner 启动 doc-contracts 之外的"排除项重新评估"工程化检查
  2. 周期 ≤ 30 天自动化（cron / PR-bot / docs 验证）

---

## D. 下一步建议（按优先级排序，不执行）

> 本节**不执行**——Mavis 决定是否切到 `representative_cases` 模式或 `baseline_ready` 模式，或维持 `scope_only` 等待 owner 决策。

### D.1 优先级 1（高，**今天/明天**就做）

1. **跑 fresh v8 coverage + 验证 8/17 commit 5070ef9 真覆盖 L199/L502/L295-298** — 不依赖 owner，可立即执行
   - 命令：`npm run test:coverage`
   - 输出：fresh coverage-final.json + clover.xml
   - 比对 8/14 → fresh 的 uncovered stmt/branch 变化
   - 若 L199/L502/L295 仍 uncovered，**8/17 commit 5070ef9 message 误导**——需修正 message 或补 case
2. **修正 §4 #13 / #19 误分类**（缺口 #2 续）
   - 拆 §4 #13 为 3 类：防御性 ?? / 行为契约 / 错误处理契约
   - §4 #19 把 L295-298 单独标"事务完整性 ROLLBACK 真不变量"
   - 写 1 个 commit 统一 8/14 / 8/17 互相矛盾的 message

### D.2 优先级 2（中，**本周末**）

3. **§3 表加"风险等级"列 + 显式中低风险登记**（缺口 #7）
   - 把 §2 "中风险 3 条 + 低风险 2 条"映射到 §3 具体对象
   - regression-model.md 层级与 §3 风险等级联动
4. **NFR 阈值标 approved 来源**（缺口 #3）
   - test-process.md §3 "10%"
   - release-regression.md §4 "P95 ≤ 1.5x" + §5 灰度比例 + 错误率
   - agent-evaluation.md §3 9 阈值加签字行
5. **安全纵深 §4 #8 决策**（缺口 #6）
   - 安全 lead 签字（推荐 owner） + PoC 是否长期生产暴露

### D.3 优先级 3（结构性，**等 owner**）

6. **接入真实模型前**（缺口 #4）：agent-nondeterministic-evaluator owner 决定时机
   - core-regression.json 启用评测 + baselines/ 落档 + 在线监控接入
7. **服务化前**（缺口 #5）：release-gatekeeper 决定时机
   - 多进程部署竞态测试补全

### D.4 模式切换建议

- **不需要切 `representative_cases` 模式**（本轮仅 scope_only 评估已完成；4 owner 决策面覆盖完整；4 部分交付齐全；剩余 8 个真缺口都是 owner 决策类，scope_only 模式产出已足够）
- **若用户准备跑 release-gatekeeper**（缺口 #3 NFR 阈值需先有 approved 来源；缺口 #4 真实模型评测需先启动）→ **建议切 `baseline_ready` 模式**生成可入库的版本化用例规范，把 618 个 it() 的"ID + 风险 + 前置 + 步骤 + Oracle + 证据"全部展开
- **若仅维持 PoC scope**（当前状态）→ **维持 scope_only 模式**，每 30 天由测试治理 owner 跑一次 §A 现状盘点 + §C 真缺口识别（缺口 #8 排除项重新评估机制）

---

## E. 校验步骤 + 移交

> 按 worker 任务规约 §"校验步骤" 4 项执行

| # | 校验项 | 命令 / 操作 | 结果 |
| --- | --- | --- | --- |
| 1 | 没改 docs/test-scope.md | `git -C D:\by56_CAP_Agent diff docs/test-scope.md` | **空（无 diff）** ✅ |
| 2 | 没动业务代码 | `git -C D:\by56_CAP_Agent status --short` | **仅 8 个 untracked vitest-*.log**（Mavis 自己 vitest 跑出的日志；不在 .tmp_scope_eval）+ `.tmp_scope_eval/` 目录（4 个文件：parse_cov.py / count_tests.py / coverage_summary.json / coverage_uncovered.txt）+ 本报告 scope_only_2026-08-18.md ✅ |
| 3 | 临时报告存在 | `Test-Path D:\by56_CAP_Agent\.tmp_scope_eval\scope_only_2026-08-18.md` | **True** ✅ |
| 4 | 真缺口清单的每条都有 evidence | 详见 §C 8 条缺口 | **全部有 v8 行号 / docs 行号 / tests 路径 / commit message 交叉验证** ✅ |

> **关于 untracked vitest-*.log**：8 个 vitest-*.log 在仓库根目录，**不是 .tmp_scope_eval/ 下**——这些是仓库当前已有的"未追踪日志"（git status 显示），本 worker 没动它们。`.gitignore` 没忽略这些日志（.gitignore 收 `.tmp_*` 模式）。如需清理由 Mavis 决定（不在本 worker 范围）。

### 移交（8/18 末态）

| 移交对象 | 内容 | 状态 |
| --- | --- | --- |
| Mavis（root）| 临时报告 `D:\by56_CAP_Agent\.tmp_scope_eval\scope_only_2026-08-18.md` + 8 项真缺口 + 4 步校验全过 | ✓ |
| `$test-execution-governor` | 缺口 #3 NFR 阈值 approved 来源 + 缺口 #1 v8 fresh evidence | DRAFT（待修） |
| `$release-gatekeeper` | 缺口 #3 release-regression.md 灰度比例 / 错误率阈值标 source | DRAFT（待修） |
| `$agent-nondeterministic-evaluator` | 缺口 #4 真实模型 CI 评测 / baselines/ 落档 / 在线监控接入 | DRAFT（结构性等 owner）|
| `$test-scope-case-designer`（下一轮）| 缺口 #2 §4 #13 拆 3 类 + #19 拆 L295-298；缺口 #7 §3 风险等级列 | DRAFT（等本报告 review）|

---

## F. 本报告触发 → 8/19 + 8/20 落地（evidence-driven discovery 完整 story）

> 本节**重写时新增**（8/18 末态时没有）。记录本报告 8 项真缺口在 8/19 续篇 + 8/20 CI 治理阶段如何被实际处理，作为"上轮决策 → 下游落地"的完整映射。**实现细节**见 [2026-08-19-scope-round/implementation-report-2026-08-19.md](../2026-08-19-scope-round/implementation-report-2026-08-19.md)，本节只写"触发 → 落地"映射，不重复细节。

### F.1 缺口 #1 v8 fresh evidence → 8/18 14:29 fresh + 8/19 + 8/20 持续落地

- **8/18 报告**（本报告 §C #1）：v8 fresh evidence 自 8/14 后未重跑
- **8/18 14:29**（同日下午）：Mavis 拍板后立即跑 `npm run test:coverage`，生成 `coverage_fresh_2026-08-18.log` + 重建 `coverage/coverage-final.json`（mtime = 2026/8/18 14:29:45）
- **8/19 续篇**（[scope-only-round-2026-08-19.md §1.2](../2026-08-19-scope-round/scope-only-round-2026-08-19.md#12-818-fresh-evidence-实测核验-814--818-uncovered-行号对比)）：fresh evidence 实测核验 8/14 → 8/18 uncovered 行号变化，L199 / L502 / L295 三个 8/17 commit 5070ef9 新增的"真不变量 case 真覆盖了"得到验证
- **8/19 implementation**：[implementation-report §2.1](../2026-08-19-scope-round/implementation-report-2026-08-19.md#21-分批策略7-commit-串行分批) 5 subagent + 2 fix subagent 全量跑测 43 file / 640 test / 0 failed + fresh coverage contact.ts 100/100/100
- **状态**：**已关闭**

### F.2 缺口 #2 §4 #13 / #19 误分类 → c6e0cdb 修正 + 8/19 + 8/20 进一步拆解

- **8/18 报告**（本报告 §C #2）：§4 #13 拆 3 类（防御性 / 行为契约 / 错误处理契约）+ §4 #19 L295-298 单列事务完整性 ROLLBACK
- **8/18 c6e0cdb**（"8/18 fresh evidence 验证 8/17 case 覆盖" commit）：实际做了"§4 #13 拆 3 行 + §4 #19 拆 2 行"（docs/test-scope.md:120-129 三行 #13 + 两行 #19）
- **8/20 c673aaa**（"docs(scope): §4 #13 第 3 行 col 3 用语修订（间接锁 → 直接锁）" commit）：worker C 核 `git show 6f910d4` 阻止了一次"凭感觉改"（6f910d4 实际没动 L321-344 业务代码，改的是 L183 / L371-382 / L471-479；f45be4b 是 test 性质）→ 用语从"间接锁"修订为"直接锁"（REAL-001~005 显式断言 throw 的是 L321 endpoint 守卫，非间接）
- **owner 教训**：c673aaa 配套保留 §4 7 列结构，doc-contracts 1 passed；不改 col 2 来源（8/19 没动 L321-L344 业务代码）
- **状态**：**已关闭**（c6e0cdb 完成主体修正，c673aaa 完成第 3 行 col 3 用语精度）

### F.3 缺口 #3 / #4 / #5 / #6 / #7 / #8 → 8/19 + 8/20 仍存

| 缺口 | 8/18 状态 | 8/19 + 8/20 落地 | 仍存原因 |
| --- | --- | --- | --- |
| #3 NFR 阈值 approved 来源 | 标 source + approved by | **8/19 §1.1 / §5 R3 派工转交**（test-execution-governor / release-gatekeeper / agent-nondeterministic-evaluator 联合签字），**8/20 未修** | 跨 3 owner 决策，需产品 / 研发 / SRE 联合签字；8/20 focus 在 CI 转绿 + docs 精度修订 |
| #4 真实 LLM + baselines/ 落档 | 结构性 | **8/19 §1.1 / §5 R4 派工等 owner**（agent-nondeterministic-evaluator 决定时机），**8/20 未修** | 接入真实模型前的结构性缺口，等 owner 决策 |
| #5 多进程竞态 | 服务化前 | **8/19 §1.1 / §5 R4 派工等 owner**（release-gatekeeper 决定时机），**8/20 未修** | 等服务化 / k8s 部署时重评 |
| #6 安全纵深 | PoC 决策 | **8/19 §1.1 / §5 R4 派工等安全 lead**（owner 仍待指定），**8/20 未修** | 需先定安全 lead + PoC 是否长期生产暴露 |
| #7 §3 范围清单 100% P0 | 缺中低风险显式登记 | **8/19 §5 R3 派工转交**（test-scope-case-designer owner 派工），**8/20 未修** | §4 7 列结构保留（doc-contracts 1 passed），§3 改列需重写 doc-contracts 期望——owner 风险高 |
| #8 排除项重新评估机制 | owner 缺失 | **8/19 §1.1 / §5 R4 派工等 owner**（测试治理 owner），**8/20 未修** | 周期 ≤ 30 天自动化未启动 |

- **状态**：**6 项仍存**（#3-#8），等跨 owner 决策

### F.4 8/19 续篇 7 角度主动新发现 → 8/19 implementation 落地 22 it + 4 业务缺口 fix

- **8/18 报告**（本报告 §D.1 优先级 1）建议"跑 fresh v8 coverage + 验证 8/17 commit 5070ef9 真覆盖"——这条**直接触发 8/19 scope_only 续篇**（AHa 8/19 09:30 ask_user）
- **8/19 §2 7 角度主动新发现（A-H 真不变量缺口）**：
  - A 类重点深扫：LLM 限流/超时/重试语义 → A1-A6 6 子缺口 → **f45be4b** 落地 6 it 到 `tests/unit/agent-callmodel-real.test.ts`（5 → 11 it）
  - B 类：SQLite lock busy → B1-B3 → **431d3aa** 新建 `tests/integration/db-lock-busy.test.ts`（3 it）
  - C 类：副作用回滚/任务幂等 → C1-C5 → **8f78b04** 扩 `tests/integration/nfr-data.test.ts`（3 → 8 it）
  - D 类：Unicode/零宽 bypass → D1-D5 → **e47572a** 新建 `tests/unit/outreach-contact-unicode.test.ts`（5 OCU it.skip XFAIL + console.log 现状 vs 期望，evidence-driven discovery 设计内 fail）→ **6257a99** 修 `server/utils/contact.ts` 5 bypass + unskip 5 OCU
  - G 类：env 变量缺失 → G1-1..3 → **66e5f99** 新建 `tests/unit/env-config-guard.test.ts`（3 it）
- **8/19 7 commit 串行分批**：[implementation-report §2.1](../2026-08-19-scope-round/implementation-report-2026-08-19.md#21-分批策略7-commit-串行分批) f45be4b / 431d3aa / e47572a / 8f78b04 / 66e5f99 / 6257a99 / 6f910d4
- **8/19 §2.5 缺口 C / §2.7 G4 / agent.ts:183**（隐含在 8/19 续篇）→ **6f910d4**（"fix(agent): 修 agent.ts 3 个真业务缺口"）：
  - Fix 1: L183 `|| 2` latent bug → `!= null` 显式检查（`llmMaxRetries: 0` 真正生效）
  - Fix 2: runTask L471-476 入口加终态 dedup 守卫（completed/failed 第 2 次 run 命中守卫直接 return）
  - Fix 3: applyResult L373-379 customer_profiling 事件顺序（先 customer-level 再 opp-level，对齐 spec §2.7 G4）
  - 配套 nfr-data C1 callCount 2→1 + C4 oppRowid<custRowid→custRowid<oppRowid
- **净增**：618 → 640（+22 it），41 → 43 测试文件，2 业务文件 fix（contact.ts + agent.ts）
- **状态**：**22 it 全部 + 4 业务缺口全部 evidence-driven 落地**（AHa 拍板的"按角度深扫"路径完整跑通）

### F.5 8/20 CI 转绿（4 commit 收尾）+ AGENTS.md §6.5 沉淀 2 条教训

- **8/20 0f29038**（"fix(typecheck): 修 tests/unit/agent-callmodel-real.test.ts L40/L46 TS7006 缺类型" commit）：L40 / L46 callback 参数加 `(value: unknown)` / `(err: unknown)` 显式标注（vi.fn() 无泛型 + noImplicitAny → TS7006）；影响 9066e30 / 6f910d4 / 66e5f99 三个 8/19 commit 的 CI 全 red（gh run 32209684960 / 32209529687 / 32209122643 typecheck step 5 fail）→ 修后 typecheck exit 0 + vitest 43 file / 640 test / 0 fail / 48.58s
- **8/20 faac650**（"chore(ignore): 排除 4 类临时调试产物（清 28 个 untracked）" commit）：.gitignore 加 4 条规则（`.tmp_*.log` / `vitest-*.log` / `coverage_fresh_*` / `.tmp_scope_eval/`）→ 配套过程披露：期间用 `git clean -fX -- <paths>` 误删 coverage/ 目录（传显式路径时 `-X` 仍扩展到 .gitignore 匹配项，实测如此）→ 立即用 `npm run test:coverage` 重建（43 file / 640 test / 0 fail + 11 子产物齐）
- **8/20 c673aaa**（如 F.2）：§4 #13 第 3 行 col 3 用语"间接锁 → 直接锁"（worker C 核 git log 触发）
- **8/20 3239a73**（"docs(agents): §6.5 新增 8/19 evidence-driven discovery + 8/20 subagent 透明披露 2 条教训" commit）：把 8/19 + 8/20 两条 owner 级教训沉淀到 AGENTS.md §6.5：
  - **D1（2026-08-19）evidence-driven discovery: 5/5 subagent fail 是设计内 fail**：scope_only 派 subagent 跑 5 OCU（Unicode/零宽/RTL/全角/NBSP bypass）真不变量 case，5/5 it fail 是设计内的 fail——subagent 按任务 spec 写 expected，实际行为 ≠ expected，测试故意 fail 产出"漏洞证据"。正确流程：`it.skip`（XFAIL）中间态 + commit 保 evidence + 修完业务代码后 unskip。实战：8/19 `e47572a`（XFAIL）→ `6257a99`（修 contact.ts + unskip）→ vitest 0 fail。反例：撤销 subagent 改动 / 让 CI 红 / 用 `it.todo` 假装没发现 / 改 expected 来"过"测试
  - **D2（2026-08-20）subagent 透明披露事故 + owner 接受**：worker B 清临时文件时 transparent 披露 `git clean -fX -- <paths>` 误删 coverage/ → 立即 `npm run test:coverage` 重建 → final report 透明披露 + 重建证据 + owner 校验建议。Owner 跑 `git status --short`（0 untracked） + `npm test`（640/0）独立验证后接受。启示：subagent 透明披露事故 > 隐瞒失败；owner 接收 working tree 必须独立跑 baseline 验证，不能只信 subagent 自报
- **状态**：**8/20 4 commit 收尾，CI 全绿 + 教训沉淀**

### F.6 末态对比（8/18 末态 vs 8/20 末态）

| 维度 | 8/18 末态 | 8/20 末态 | 差量 |
| --- | --- | --- | --- |
| 测试文件 | 41 | 43 | +2（新 outreach-contact-unicode + db-lock-busy + env-config-guard 共 3，但 agent-callmodel-real + nfr-data 是扩，净 +2） |
| 跑测总数 | 618 | 640 | +22 it（5 OCU 8/19 skip → 8/19 unskip；5 OCU + 6 A + 3 B + 5 C + 3 G = 22） |
| 业务代码 statement 覆盖 | 99.3% (1494/1504) | contact.ts 100% + 其余类似 | 持平（fix 后无回归） |
| 业务代码 branch 覆盖 | 90.3% (578/640) | 类似持平 | 持平（fix 后无回归） |
| 8/18 真缺口状态 | 8 项全 OPEN | 2 项已关闭（#1 fresh / #2 §4 修正）+ 6 项仍存 | -2 OPEN |
| CI 状态 | 本地跑通 / push 后未验证 | CI 全绿（8/20 0f29038 / c673aaa 修后） | +CI 验证 |
| 教训沉淀 | 4 条 8/14 教训 | 4 条 8/14 + 2 条 8/19/8/20 = 6 条 | +2 条 |
| 8/18 原始报告位置 | `.tmp_scope_eval/scope_only_2026-08-18.md`（working tree） | **本归档任务完成后**：本报告在 `docs/history/2026-08-18-scope-round/scope-only-round-2026-08-18.md` | 从 working tree 移到历史归档 |

---

## G. 归档说明

> 本节**重写时新增**（8/18 末态时没有）。记录 8/18 原始 working tree 报告如何从 `.tmp_scope_eval/` 移入 `docs/history/2026-08-18-scope-round/` 的归档决策与配套动作。

### G.1 归档决策

- **本报告**（`scope-only-round-2026-08-18.md`）由 8/18 原始 33KB 版 `.tmp_scope_eval/scope_only_2026-08-18.md` **改写**而来：
  - 保留：§0 表 → §1 重编号 / §A-E 现状盘点 / owner 决策面 / 真缺口 / 下一步 / 校验 / 移交
  - 新增：§0 摘要 + §F 本报告触发 → 8/19 + 8/20 落地 + §G 归档说明
  - 不重复：8/19 + 8/20 实现的细节（细节在 [2026-08-19-scope-round/implementation-report-2026-08-19.md](../2026-08-19-scope-round/implementation-report-2026-08-19.md)）
- **evidence 链归档决策**：采用**选项 A**（完整 evidence 链）— 5 个 `.tmp_scope_eval/` 文件全部归档：
  - 主报告 1 个 → 根目录 `docs/history/2026-08-18-scope-round/scope-only-round-2026-08-18.md`
  - evidence 4 个 → 子目录 `docs/history/2026-08-18-scope-round/evidence/`：
    - `count_tests.py`（1,412 bytes）— Python 解析 vitest 输出的脚本
    - `parse_cov.py`（4,263 bytes）— Python 解析 coverage-final.json 的脚本
    - `coverage_summary.json`（12,789 bytes）— 8/18 fresh coverage summary（per-file stmt/branch/fns + uncovered lines）
    - `coverage_uncovered.txt`（3,456 bytes）— 8/18 fresh coverage 未覆盖行（人类可读版）
  - **理由**：evidence-driven 是硬要求（AGENTS.md §6.4 / §6.5）—— 解析脚本 + evidence 数据是"可复现 evidence"，丢弃等于"声称 99.3% 覆盖但不能复现"
  - **目录约定分歧**：参考 `2026-08-19-scope-round/` 等历史目录是 flat 风格（无 subdirectory），但本归档 5 文件用 subdirectory 隔离（主报告 vs evidence 数据）更清晰。子目录用法符合 `2026-07-29-repair/` 等历史目录的实际复用模式（虽然没用 subdirectory，但本任务文件数较多）

### G.2 配套动作

- **`.gitignore` 修订**：删 `.tmp_scope_eval/` 那一行（8/20 commit `faac650` 加的临时规则；归档完 working tree 不再有此目录）。改前 4 行（`.tmp_*.log` / `.tmp_scope_eval/` / `vitest-*.log` / `coverage_fresh_*`）→ 改后 3 行（`.tmp_*.log` / `vitest-*.log` / `coverage_fresh_*`）。其余 7 行已有规则（`coverage/` / `.tmp_*.out` / `.tmp_*.err` / `.tmp_audit/` 等）保留。
- **`.tmp_scope_eval/` 物理文件**：**本任务不删**——按 `AGENTS.md §6.5 D2` 教训，删除动作留给 Mavis 决定（`mavis-trash` 或 `rm -rf` 或 `git clean -fdX`）。删完前 working tree 会显示 untracked（`.gitignore` 已删该行 + 物理文件还在 = untracked）；删完后 working tree 干净。
- **commit / push**：本任务**不 commit**——Mavis 决定是否整包 commit（建议拆 2 commit：① docs/history 新增 5 文件；② .gitignore 删 1 行）

### G.3 上下游衔接

- **上游（本报告）**：`codex/AHa-testing` 8/18 末态（HEAD = `46236dd`）触发的 scope_only 盘点
- **下游**：
  - 8/19 scope_only 续篇（[scope-only-round-2026-08-19.md](../2026-08-19-scope-round/scope-only-round-2026-08-19.md)）— §1.1 缺口 #1 / #2 已关闭 / §1.2 fresh evidence 实测核验
  - 8/19 implementation（[implementation-report-2026-08-19.md](../2026-08-19-scope-round/implementation-report-2026-08-19.md)）— 5 subagent + 2 fix subagent 22 it + 4 业务缺口
  - 8/20 CI 转绿（commits `0f29038` / `faac650` / `c673aaa` / `3239a73`）— typecheck / chore / docs(scope) / docs(agents)
- **AGENTS.md §6.5**：6 条教训（4 条 8/14 + 2 条 8/19 + 8/20）；本报告归档任务对应"D1 evidence-driven discovery" 教训的事后归档（5/5 OCU fail 的设计内 fail → 修 contact.ts → unskip → 0 fail）

---

**维护**：Mavis（root，scope_only 模式）
**审核**：AHa
**下次复盘**：缺口 #3-#8 owner 签字后（跨 4 owner）；§G.2 物理文件清理后
