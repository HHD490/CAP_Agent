# CAP_Agent — Agent Working Agreement

> 本文件由 Mavis（MiniMax Code）维护。接手此项目的任何 agent / session / 工具
> 在动手前必须先读完整文件；违反以下任一条，等同于绕过用户的工作流约定。

---

## 1. Git 管理硬规则（最高优先级）

### 1.1 默认分支约定
- **`codex/AHa-testing` 是这个项目唯一的工作分支**
- 所有提交、PR、revert、reset、merge 操作都必须在 `codex/AHa-testing` 上完成
- **`main` 是只读基线分支**，由仓库所有者（HHD490）通过 PR 节奏从 `codex/AHa-testing` 拉过去

### 1.2 ❌ 绝对禁止直推 main
- **不允许**任何形式的 `git push origin main`（普通 push / `--force` / `--force-with-lease` 都不行）
- **不允许** `git reset --hard <X> && git push --force origin main`
- **不允许** 通过 `gh api` / GitHub UI 等任何通道直接改写 `main` 的历史
- 任何"想回退 main 上 N 个 commit"的需求，**只允许在 `codex/AHa-testing` 上做**，
  然后通过 PR 把回退带到 main

### 1.3 ✅ 正确的回退 main 姿势
- 在 `codex/AHa-testing` 上 `git revert <sha>` 目标 commit
- push `codex/AHa-testing` 分支
- 开 PR 合回 main
- **绝不**为了"干净历史"去 force-push main —— 这条由用户 2026-08-12 10:44 明确确认

### 1.4 如果用户选了"直推 main"的选项
- 必须先停下来，反向确认："这个动作本质就是 force-push main，违反 §1.2。要继续吗？"
- 给两个备选：
  1. 用 §1.3 的 revert + PR 流程
  2. 用户明确二次确认后才执行 force-push

### 1.5 涉及 main 的允许操作
- 读取 / 查看 / compare（`git log origin/main` / `gh api .../compare/...` / `gh pr view`）
- 在 `codex/AHa-testing` 上 `merge origin/main`（让分支跟 main 同步）
- **在 `codex/AHa-testing` 上** `rebase origin/main`（线性化本地历史）
- 开 PR 合回 main（PR 的"合并"按钮由用户在 GitHub UI 触发，不由 agent 自动 merge）

---

## 2. 仓库元信息

| 字段 | 值 |
|---|---|
| Remote | `https://github.com/HHD490/CAP_Agent.git` |
| Owner | HHD490（个人账号） |
| 工作分支 | `codex/AHa-testing`（HHD490 本地 + 远端） |
| 基线分支 | `main`（只读，不直推） |
| 平台 | Windows / PowerShell（命令见根 README 与 memory） |
| 本地路径 | `D:\by56_CAP_Agent\` |

## 3. 与本仓库相关的常见反模式

- ❌ 把 commit 直接做在 main 上 / 直接 push 到 main
- ❌ 出于"想看 main 长什么样"而在 main 上 `git checkout` + 改文件
- ❌ "为了省事"用 `gh repo edit` 改默认分支 / `gh api -X PATCH` 改 branch protection
- ❌ 替用户 merge PR 到 main（让用户在 GitHub UI 点）
- ❌ 在 `codex/AHa-testing` 上做不与 NFR / 测试 / docs 相关的随机改动
- ❌ 直接编辑 `docs/test-scope.md` / `docs/test-process.md` / `docs/release-regression.md` / `docs/agent-evaluation.md` 而不走对应 skill（绕过 §6.2 的 owner 决策面）
- ❌ 用 `release-gatekeeper` 决定业务阈值 / 用 `test-scope-case-designer` 决定生产流量 / 用 `test-execution-governor` 替范围定回归层级（owner 越权；详见 §6.2 / §6.3）
- ❌ 把 Codex 默认的"普通调研 / 路由 / 交接 / 一次性原型 / 学习辅导"包装成新 skill 调用（README 红线：薄包装不创建 skill）
- ❌ 一次性全量安装 16 个 skill —— 按需展开、按状态选模式，未安装的可选后继回退到 Codex 默认能力
- ❌ 改 `docs/*.md` 表结构 / 章节 / 字段不先查 `doc-contracts` 契约 test（2026-08-14 CI 失败教训，见 §6.5）

## 4. 历史教训（2026-08-12）

Mavis 在 2026-08-12 10:11 / 10:42 两次 `git push --force origin main`：
- 第一次：用户问"要干净历史"时，agent 选了 force-push 而没先二次劝阻
- 第二次：直接 reset 到根 commit `65e213a`，没在 `codex/AHa-testing` 走 PR 流程

**根因**：把"用户选项里的字面意思"等同于"可以执行"，没识别 force-push main
违反了 `codex/AHa-testing` 是唯一工作分支的隐含规则。
**修正**：本文件 §1。

---

## 5. 旁路（不归 Mavis 管的事）

- 用户自己在本地 git 命令行 / GitHub Desktop / VSCode Source Control 上的操作
  不受本文件约束（这是用户主权）
- 用户明确说"我已知道风险，继续"并二次确认的 force-push main，可以做（但必须在
  agent 自己的 turn 注释里记录：用户二次确认的时间 + 选项）

---

## 6. quality_tests_skills 使用规范

> 本项目调用 Codex skill 的统一纪律。**CORE 4**（test-scope-case-designer / test-execution-governor / release-gatekeeper / agent-nondeterministic-evaluator）= 本仓库 4 个核心 docs 文档的唯一 owner。任何越权、绕过、薄包装都属于本节禁止项。

### 6.1 概述与路径

- **skill 包路径**：`D:\quality_tests_skills\`（**外部复制**，不是仓库内置 skill）
- **来源仓库**：https://github.com/JJ704sd/by_test_skills.git
- **总原则**（每条 1 句）：
  - **按状态选模式**：相邻生命周期合并为一个入口，但一次只进入一个明确模式
  - **按需展开**：核心路由与硬约束留在 `SKILL.md`，分支方法放 `references/`
  - **证据优先**：项目阈值必须带来源 / 口径 / 适用范围 / 批准状态
  - **授权隔离**：范围 / 执行 / Agent 质量 / 生产流量分别由不同 owner 决策
  - **资源自包含**：复制完整 skill 目录即可获得资源；未安装的可选后继回退到 Codex 默认能力

| 场景组 | Skill | 决策权 / 职责 | 本项目是否常用 |
| --- | --- | --- | --- |
| 01 仓库配置 | `configure-engineering-skills` | 探测并一次性配置 tracker、triage 标签和领域文档布局 | 一次性（仓库初始化时） |
| 02 领域建模 | `domain-modeling` | 维护 canonical vocabulary + ADR（只为已解决、难逆的决策） | 按需 |
| 03 人员输入 | `elicit-stakeholder-input`（`live` / `async`） | 与当前用户或另一知识持有人澄清不可发现判断 | 按需 |
| 04 持久化规划 | `plan-engineering-work`（`map` / `spec` / `slice`）/ `triage` | 决策图 / 父规格 / 实现切片 / 外部 issue 验证 | 偶用 |
| 05 代码库设计 | `codebase-design`（`scan` / `design`） | 架构候选扫描 / 已选模块接口设计 | 偶用 |
| 06 实现与诊断 | `tdd` / `refactoring-safely` / `evolving-contracts` / `diagnosing-bugs` / `review-code-against-spec` / `resolving-merge-conflicts` | TDD / 重构 / 契约迁移 / 诊断 / 审查 / 冲突解决 | 常用 |
| **07 质量、评测与发布** | **`test-scope-case-designer` / `test-execution-governor` / `release-gatekeeper` / `agent-nondeterministic-evaluator`** | **范围与用例 / 执行准出 / 发布门禁 / Agent 评测** | **CORE 4** |

### 6.2 本项目的 CORE 4 技能

| Skill | 何时必须调用 | 本项目产物 | 它**不**决定的事 |
| --- | --- | --- | --- |
| `$test-scope-case-designer` | 增 / 改测试范围、回归层级、风险评级、用例意图 | `docs/test-scope.md`（高/中/低风险 + 范围清单 + spec-vs-actual 抽样） | 不决定工具选型、不决定生产流量、不决定业务阈值 |
| `$test-execution-governor` | 改测试工具 / 环境 / 权限 / 执行准出 / 暂停 / 关闭 | `docs/test-process.md` / `docs/test-tool.md` / `docs/test-pipeline.md` | 不替范围定回归层级；测试准出不能推导生产门禁 |
| `$release-gatekeeper` | 改发布方式、灰度、停止、回滚、生产采样 | `docs/release-regression.md`（GO / NO_GO / BLOCKED / ROLLBACK） | 不重定义范围、不生成语义评测、不决定业务阈值 |
| `$agent-nondeterministic-evaluator` | 改 5 个 Agent 模式的评测集 / 采样 / 阈值 / 漂移信号 | `docs/agent-evaluation.md`（`tests/agent-evaluation/core-regression.json` + 基线） | 不决定生产流量、不替发布门禁 |

> 工具选择 / 执行授权 / 测试门禁 / 执行进度 / 生命周期状态互不推定（owner 表见 `skills-distribution.md` §07）。

### 6.3 任务路由表

| 任务 | 使用 skill |
| --- | --- |
| 增 / 改测试范围、回归层级、判据、用例意图 | `test-scope-case-designer` |
| 改测试工具 / 环境 / 执行准出 / 暂停 / 关闭 | `test-execution-governor` |
| 改发布门禁 / 灰度 / 停止 / 回滚 | `release-gatekeeper` |
| 改 Agent 评测集 / 采样 / 语义质量 / 漂移信号 | `agent-nondeterministic-evaluator` |
| 加新功能 + 要求 test-first | `tdd` |
| 重构（调用者可见行为不变） | `refactoring-safely` |
| 改公开 API / schema / 数据 / 依赖 / 框架 | `evolving-contracts` |
| 根因未知 / 偶发失败 / flaky / 性能回归 | `diagnosing-bugs` |
| 审查固定 diff vs 仓库标准 + 原始 spec | `review-code-against-spec` |
| merge / rebase 冲突 | `resolving-merge-conflicts` |
| 仓库配置 / tracker 标签 / 领域文档布局（一次性） | `configure-engineering-skills` |
| 领域词汇 / ADR 沉淀 | `domain-modeling` |
| 跟当前用户确认不可发现判断 | `elicit-stakeholder-input: live` |
| 为另一知识持有人生成异步问卷 | `elicit-stakeholder-input: async` |

> ⚠️ **`live` 与 `async` 不能静默切换**：当前用户在场 = `live`；另一人持有私有上下文 = `async`。两个模式不能互相顶替。
> 普通小范围实现继续使用 Codex 默认能力，**不要**为它包装新 skill（README 红线）。

### 6.4 调用约定

- **调用语法**：用 `$<skill-name>` 显式点名，附 1 句任务描述（"为什么调它" + "要它做什么"）。
  - ✅ `使用 $test-scope-case-designer 评估 L324-344 的真不变量并设计 case`
  - ✅ `使用 $release-gatekeeper 判定 v1.2.0 是否可以走 10% 灰度`
  - ❌ `让 Codex 想想测试该怎么写`（无 skill、无任务描述）
  - ❌ `用诊断 + TDD + 重构 + 评审一把搞定`（诊断与 TDD 修改授权不同，不能并入同一调用）
- **一次只进入一个明确模式**：`plan-engineering-work` 的 `map` / `spec` / `slice`、`codebase-design` 的 `scan` / `design`、`elicit-stakeholder-input` 的 `live` / `async` 都不自动推进整个生命周期。
- **并行规则**（来自 `development-orchestration-efficiency-spec.md §2` 共同不变量）：
  - **先图后并行**：先识别依赖、当前 frontier、读写集合，再决定是否 fan-out
  - **固定输入**：并行节点用同一份 revision / diff / spec / 复现条件；输入改变后重验旧结论
  - **有界并行**：只并行当前 frontier 上彼此独立、可独立验收、收益大于调度成本的节点
  - **写入互斥**：共享接口、生成物、数据、环境、Git 状态由一个 owner 串行写入
  - **单一 fan-in**：主责 Agent 独占最终集成与 Git 操作
- **证据闭环**：每轮记录 `目标 / 动作 / 观察 / 相对上一轮增量 / 下一步或停止原因`。
- **预算 ≠ 完成证据**：预算耗尽时**显式报告未覆盖范围**，**不得**把停止描述为通过 / 诊断 / 确认。
- **subagent 纪律**：subagent 不能替用户作业务判断、扩大副作用或绕过审批；subagent 失败时派**新** subagent 重做，Mavis 不接管编辑。

### 6.5 历史教训（项目级，2026-08-14）

- **evidence-driven 是硬要求**：Mavis 凭 "609 测试 0 失败" 判断"够覆盖"被用户反驳；§6.4 的"证据闭环"和"预算 ≠ 完成证据"就是从这次事件抽出，**不要**用"通过率 100%"代替"是否覆盖了 §6.2 owner 决策面"。
- **subagent 失败 → 派新 subagent**：subagent A 错改 docs 后被撤销；Mavis 不接管 subagent 失败的编辑，只在路由表里再发一次任务，由新 subagent 走 §6.4 调用约定重做。
- **改 docs 表结构 = 同步改契约 test**：改 `docs/test-scope.md` §4 列结构没同步 `doc-contracts` 期望 → CI 失败；任何 docs 结构调整 / 字段新增 / 章节重排必须先查 `tests/integration/doc-contracts.test.ts` 的契约期望，再回 §3 末尾的反模式同步核对。
