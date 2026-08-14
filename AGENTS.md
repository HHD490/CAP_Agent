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
