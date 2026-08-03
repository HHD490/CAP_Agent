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
