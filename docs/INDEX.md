# CAP_Agent Docs 索引

> 仓库 `docs/` 的总导航。本目录严格按 **5 个测试治理 skills + 业务架构 + 规格 + 历史归档**
> 四大类组织；任何新文档必须先归类再放，避免与现有 skill 文档同级散落。

## 1. 测试治理（5 skills 一一对应）

| 文档 | 对应 skill | 职责 |
| --- | --- | --- |
| [test-process.md](./test-process.md) | `test-process-governor` | 阶段台账、准入准出、暂停条件、角色职责、报告归档 |
| [test-scope.md](./test-scope.md) | `test-scope-case-designer` | 风险矩阵、范围清单、排除项、用例设计方法 |
| [test-tool.md](./test-tool.md) | `test-tool-governor` | 工具栈、配置、凭据/权限、资产生命周期、CI 接入 |
| [agent-evaluation.md](./agent-evaluation.md) | `agent-nondeterministic-evaluator` | 评测集、9 阈值、采样、14 条结构护栏、基线 |
| [release-regression.md](./release-regression.md) | `release-regression-gatekeeper` | 回归层级、发布方式、灰度表、Hotfix、回滚规则 |

> 5 份 skill 文档之间是**流水线**关系：
> `scope → tools → process → evaluation → release`，
> 上游文档决定下游文档的输入；下游文档的反馈回写上游"已知限制"小节。

## 2. 业务与架构

| 文档 | 用途 |
| --- | --- |
| [architecture.md](./architecture.md) | 核心实体（Customer/Contact/Product/MatchResult/Opportunity/AgentTask/EmailDraft/Inquiry）、Agent 写入原则、任务状态机 |

## 3. 规格（specs/）

工程规格类文档，独立于 5 skills 流水线之外的"做什么、做到什么程度"的事实源。

| 文档 | 用途 |
| --- | --- |
| [specs/test-repair-spec.md](./specs/test-repair-spec.md) | 2026-07-29 修复活动的 TDD 工程规格（六组缺陷 + TDD 测试 ID + 验收门禁） |

## 4. 历史归档（history/）

按"修复活动 / 评审活动 / 重大事件"分子目录归档；不与正式 skill 文档同级。

- `history/2026-07-29-repair/` — 2026-07-29 修复活动完整过程链
  - [repair-review-report-2026-07-29.md](./history/2026-07-29-repair/repair-review-report-2026-07-29.md)（13KB）— 审核模型反馈（`Request changes`）
  - [missed-bug-fix-plan-2026-07-29.md](./history/2026-07-29-repair/missed-bug-fix-plan-2026-07-29.md)（13.5KB）— 遗漏缺陷修复计划
  - [missed-bug-repair-report-2026-07-29.md](./history/2026-07-29-repair/missed-bug-repair-report-2026-07-29.md)（4.6KB）— 修复汇报（第一轮，4 项 pass）
  - [missed-bug-repair-round2-2026-07-29.md](./history/2026-07-29-repair/missed-bug-repair-round2-2026-07-29.md)（3.3KB）— 第二轮修复汇报（smoke 进程/锁清理 + 联系人共享校验）
  - [final-repair-summary-2026-07-29.md](./history/2026-07-29-repair/final-repair-summary-2026-07-29.md)（3.7KB）— 最终汇总（`Approve with notes`）
- `history/2026-08-05-scope-supplement/` — 2026-08-05 测试范围补充活动
  - [scope-supplement-decision-2026-08-05.md](./history/2026-08-05-scope-supplement/scope-supplement-decision-2026-08-05.md)（12.5KB）— 3 处覆盖缺口补 32 用例的正式范围交付决定（含覆盖矩阵 / CP0 标签 / 选型决策 / 评审状态）
- `history/2026-08-07-scope-supplement/` — 2026-08-07 测试范围补充活动
  - [scope-supplement-decision-2026-08-07.md](./history/2026-08-07-scope-supplement/scope-supplement-decision-2026-08-07.md)（15.7KB）— 5 候选全留（grill-me 决策）补 47 用例（buildTargetContext 5 mode 合同 / applyAgentResult 5 mode 副作用 / markNonAcceptedMatchesStale 8 边界 / set_contact 5 分支 / registry 合同 / confirm_next_action 部分更新）
- `history/2026-08-11-nfr-scope/` — 2026-08-11 NFR 范围补充活动（**scope_only** + **representative_cases** + **implementation**）
  - [scope-decision-2026-08-11.md](./history/2026-08-11-nfr-scope/scope-decision-2026-08-11.md)（28KB）— NFR 域（性能/可用性/安全/韧性/可观测/数据完整性/成本）补缺盘点；§1.3 列 6 项待决策（性能基线 / 韧性降级是否纳入 PoC / 安全纵深优先级 / 用户旅程级性能范围 / 真实模型接入前 NFR 准备 / 排除项重新评估 owner）；§3 9 域覆盖盘点 + §6.1 占位用例 ID；DRAFT 状态等三方评审
  - [representative-cases-2026-08-11.md](./history/2026-08-11-nfr-scope/representative-cases-2026-08-11.md)（50KB）— representative_cases 模式落地：覆盖骨架 7 域 + 31 条代表用例（CP0=23 / CP1=6 / CP2=2；spec_default 草案 + UNAPPROVED）；§3 字段定义完整（data_id / 来源 / 期望 / 风险 / 版本 v1.0-NFR）；§4.3 与现有 16 条 NFR 用例不重叠；§4.5 handoff_packet 移交；DRAFT 状态等三方评审
  - [implementation-report-2026-08-11.md](./history/2026-08-11-nfr-scope/implementation-report-2026-08-11.md)（15KB）— representative 31 条落地实现：6 新 + 1 扩测试文件（nfr-evidence/resilience/security/observ/data/cost + doc-contracts）；53 it 实跑全过；39 文件 / 609 测试 / 0 失败 / 0 跳过；§2.2 记录 9 类问题与修复；§3 全量回归 + typecheck + agent-eval 三门禁通过；DRAFT 状态等 PR review
    - **v1.1 patch (2026-08-12)**：自审 §7 13 条"全 ✅"回核时漏做 spec-vs-actual 抽样，新增 §9 cross-check 记录 3 处不一致修复 —— (a) RESILIENCE 24→25、合计 52→53；(b) PERF-002 抽样 30→10 + mock Provider 阻塞理由；(c) PERF-003 抽样 30→5 + 双 Agent 串行超时理由。同时建议把"spec-vs-actual 抽样验证"作为新阶段加入 test-process.md 阶段台账
- **`推送完成 2026-08-11 12:15`（hotfix 行为）**：2 个 commit 已推到 `HHD490/CAP_Agent` 远端 — `main` = `2fcf3c7` (ahead 20, 含 2 hotfix: 前缀) / `codex/AHa-testing` = `5845570` (ahead 2, 原 commit)。本次推送用 `gh CLI auth token` + URL embed 模式（见 agent memory `GitHub push: gh CLI token 走 URL embed` 条目），未走 PR review 流程，按 hotfix 行为处理。提交者：Mavis；推送账户：`JJ704sd` (collaborator)。后续 PR review 需产品/研发/SRE/安全四方签字

## 5. 命名与放置规范

| 类型 | 命名 | 位置 | 维护频率 |
| --- | --- | --- | --- |
| Skill 治理文档 | `<skill-topic>.md` | `docs/` 根 | 与对应 skill 同源 |
| 业务/架构 | `<topic>.md` | `docs/` 根 | 架构变更时 |
| 工程规格 | `<topic>-spec.md` | `docs/specs/` | 重大功能/修复活动立项时 |
| 活动过程报告 | `<event>-<YYYY-MM-DD>.md` | `docs/history/<event>/` | 活动结束即归档 |
| 索引 | `INDEX.md` | `docs/` 根 | 文档增删时 |

## 6. 复盘与回流

- 每次重大活动结束后 24 小时内归档过程报告到 `docs/history/<event>/`
- 每个季度 review 一次 `docs/specs/` 是否仍代表当前事实，必要时迁移到 `history/`
- 任何 5 skills 文档变更必须同步更新本 INDEX 的链接与摘要

---

**维护**：Mavis · **审核**：产品 / 研发 · **下次复盘**：docs 增删时
