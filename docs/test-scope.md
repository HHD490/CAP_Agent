# 测试范围与用例设计说明

> 基于 [test-scope-case-designer](../README.md) skill 的标准模板。本文档是 CAP_Agent
> 项目的"测什么、测到多深、为什么这样测"的唯一事实源。

## 1. 变更摘要

- 项目：链航智能获客中台 PoC（logistics-acquisition-poc / 内部代号 CAP_Agent）
- 范围：Nuxt 3 全栈 PoC，5 段式客户旅程（建档 → 画像 → 匹配 → 建联 → 回复判断 → 交接）
- 关键变更触发器：Prompt / 模型 / 工具 / 知识库 / 业务规则任何一项变化

## 2. 风险分析

### 高风险（必须全量回归 + 离线评测）

| 风险 | 业务影响 | 触发器 | 防护 |
| --- | --- | --- | --- |
| Agent 5 个模式输出漂移 | 客户被错配/错推/漏推 | Prompt/模型/工具链变更 | `tests/agent-evaluation/core-regression.json` 离线评测 + 基线对比 |
| reply_qualification intent 错判 | 客户进错阶段、丢单 | 模型变更 | `agent-reply-qualification.test.ts` 15 用例 |
| 联系人校验漂移 | 邮件发不出去 / 错发 | Agent vs demo action 规则不一致 | `outreach-contact.test.ts` + `isValidOutreachContact` 共享工具 |
| accepted 匹配被错误 stale | 已签合同被重写 | rematch/identity/update_* 路径 | `rematch-identity-stale.test.ts` + `demo-actions-workflow.test.ts` |
| BY004 误发布 | 客户被匹配到未发布产品 | seed 漂移 / migration 漏跑 | `legacy-publish.test.ts` + `product-publish.test.ts` |
| 官网身份留资部分写入 / 伪造产品选择 | 400 响应后残留脏客户，或绕过推荐选择未发布产品 | `identity.post` 校验顺序与产品 ID 篡改 | `website-journey.test.ts` 原子性 + 推荐归属校验 |
| SMTP / 白名单绕过 | 误发邮件给非白名单地址 | `send_email` 路径 | `demo-actions-workflow.test.ts > DEMO-EMAIL-*` |

### 中风险（核心功能回归 + 接口验证）

- 跟进提醒漏发 / 误暂停
- demo 14 个 action 任一分支行为漂移
- state.get 计数错误（运营决策误导）

### 低风险（冒烟 + 受影响模块回归）

- 文案、日志格式、Vue 组件样式
- promptfoo 数据库种子数据

## 3. 测试范围清单

| 对象 | 测试类型 | 深度 | 优先级 | 环境/数据 | 负责人 | 覆盖文件 |
| --- | --- | --- | --- | --- | --- | --- |
| DB 工具层 | 数据层 | addEvent 默认值 / `demoNow` 防御 `CURRENT_TIME` 关键字 / `initializeDatabaseConnection` 幂等 / `prepareOpenedDatabase` 重启清理防御 / `runDatabaseMigrations` BY004 幂等 | P0 | 单元 | Mavis | `db-utils.test.ts` (12) |
| Agent 5 模式 schema | 契约 | 全量边界 | P0 | 单元 | Mavis | `agent-schemas.test.ts` (65) |
| reply_qualification | 功能 | 全 intent × 边界 | P0 | 单元 | Mavis | `agent-reply-qualification.test.ts` (15) |
| Agent 任务生命周期 | 功能 | 创建/停止/状态机/留痕/级联 | P0 | 单元 | Mavis | `agent-lifecycle.test.ts` (18) |
| Agent 任务端点边缘 | 契约/状态 | 同 target 多 mode 互不串 / stop 终态幂等 / stop 后可重建 / task 起步 + stop step 留痕 / HTTP dedup 一致性 | P0 | 单元 | Mavis | `agent-tasks-edge.test.ts` (10) |
| useDemoState composable | 前端契约 | refresh 防抖/quiet/通知维护/同数据不替换 / runAgent / doAction / resetDemo / advanceTime | P0 | 单元 | Mavis | `use-demo-state.test.ts` (16) |
| demo action 14 分支 | 功能 | 异常 + 边界 + 业务规则 | P0 | 单元 | Mavis | `demo-actions-workflow.test.ts` (35) |
| advance-time 跟进提醒 | 功能 | 首次/二次/暂停/不触发 | P0 | 单元 | Mavis | `advance-time-reminders.test.ts` (14) |
| state.get 端点 | 接口 | shape + counts + 排序 | P0 | 单元 | Mavis | `state-endpoint.test.ts` (22) |
| agent tasks HTTP | 接口 | zod 校验 + dedup + stop | P0 | 集成 | Mavis | `agent-tasks-endpoint.test.ts` (19) |
| 官网 quote/identity/rematch | 接口/安全 | 主链路 + 会话隔离 + 原子校验 + 注入 | P0 | 集成 | Mavis | `website-journey.test.ts` (35) |
| 官网产品推荐 | 规则/边界 | published + Top3 + 路线/货类/能力/偏好计分 | P0 | 单元 | Mavis | `website-recommendations.test.ts` (5) |
| Demo 数据重置 | 恢复/幂等 | 标准种子 + 清理 + BY004 安全不变量 | P0 | 单元 | Mavis | `demo-reset.test.ts` (3) |
| 产品发布 (BY004 等) | 迁移/状态 | published 过滤 + simulated 排序 | P0 | 单元 | 已有 | `product-publish.test.ts` (3) |
| Agent 离线评测 | 非确定性 | 100 用例 / 5 mode / 9 阈值 / 追溯字段 | P0 | JSON+reporter | Mavis | `agent-evaluation.test.ts` (14) + `core-regression.json` |
| 联系人校验 | 功能 | whitespace / status / 跨入口 | P0 | 单元 | 已有 | `outreach-contact.test.ts` |
| 匹配 stale 保护 | 功能 | rematch/identity/update_* | P0 | 集成 | 已有 | `rematch-identity-stale.test.ts` |
| demo action stale 联动 | 集成 | update_* 触发 stale + accepted 保护 | P0 | 集成 | 已有 | `demo-action-stale.test.ts` |
| import xlsx/csv | 接口 | 中英表头 / 重复 / 空行 / 空或损坏文件 / 200 行上限 / 体积 / 5MB 精确边界 / member_id 优先级 | P0 | 集成 | 已有 | `import-xlsx.test.ts` (17) + smoke |
| 客户画像类型 | 功能 | 6 枚举 + 非法值 | P0 | 单元 | 已有 | `profile-type.test.ts` |
| BY004 修正 | 迁移 | 6 路径 + 幂等 | P0 | 单元 | 已有 | `legacy-publish.test.ts` |
| handoff 契约 | 功能 | object/string 双兼容 | P0 | 单元 | 已有 | `handoff-contract.test.ts` |
| handoff 旧字符串路径 | 兼容 | 旧字符串 recommended_product 解析 | P0 | 单元 | 已有 | `handoff-legacy.test.ts` |
| smoke 入口 | 集成 | Windows Nitro dev/build | P1 | smoke | 已有 | `smoke-entry.test.ts` + `import-xlsx.smoke.test.ts` |

> 数字 = 当前用例数；总计 342 条确定性单元/集成 + 100 条离线评测数据 + 2 条 Windows Nitro smoke。
>
> **2026-08-04 更新**：按 codex/AHa-testing 分支新加 3 个单元测试文件（`db-utils` / `agent-tasks-edge` / `use-demo-state`）+ import-xlsx 追加 4 条边界，共 +42 条用例（300 → 342）。同步补齐之前 §3 漏列的 3 个旧文件（`product-publish` / `demo-action-stale` / `handoff-legacy`）以让清单与实际 22 文件对齐。

## 4. 排除项与假设

| 排除项 | 原因 | 责任人 | 重新评估条件 |
| --- | --- | --- | --- |
| 真实 LLM 端到端评测 | PoC 不接生产模型，CI 跑确定性测试 | Mavis | 接入真实模型时启用 `agent-evaluation/*` |
| UI 自动化（Playwright） | 演示系统只在 Chrome 演示，单浏览器 | Mavis | 进入长期版本或回归频繁时评估 |
| 性能压测 | PoC 30 + 8 + 3 客户量级，无性能风险 | Mavis | 客户数 >1000 或服务化时 |
| 真实 WCA 抓取 | 项目明文"不抓取真实 WCA 目录" | Mavis | 永远排除 |
| 国际化 i18n | 文案以中文为主，英文邮件由 Agent 生成 | Mavis | 多语种支持立项 |
| 跨浏览器兼容 | 仅 Chrome 演示 | Mavis | 客户端版本立项 |

## 5. 用例设计方法

| 场景 | 首选方法 | 本项目实例 |
| --- | --- | --- |
| Schema 字段 | 等价类 + 边界值 | `agent-schemas.test.ts` 65 用例 |
| 业务操作流程 | 场景法 | `demo-actions-workflow.test.ts` 14 个 action |
| 多条件组合 | 判定表 | `outreach-contact.test.ts` status × email 组合 |
| 鲁棒性/异常 | 错误推测 | `advance-time-reminders.test.ts` 已收过 0/1/2 次 |
| 状态机/工作流 | 状态转换图 | `agent-lifecycle.test.ts` queued→running→completed/failed/stopped |
| Agent 非确定性 | 多样性 + 对抗性 | `core-regression.json` 100 用例 + 5 mode |

## 6. 交付物

- **范围清单**：本文档 §3
- **用例集版本**：
  - 单元/集成：vitest `tests/unit/**/*.test.ts` + `tests/integration/**/*.test.ts`（21 个文件，300 用例）
  - 离线评测：`tests/agent-evaluation/core-regression.json`（v1.0, 100 用例）
- **测试数据**：每个测试用 `useIsolatedDb()` 临时 SQLite 库，互不影响
- **环境**：本地 Node 22 + Vitest 3.2 + Windows-native xlsx 兼容
- **评审结论**：待产品 + 研发确认（v1.0）

## 7. 复盘与回流

- 每次线上失败必须新增 ≥1 条用例到 `core-regression.json` 的对应 mode
- Agent 重构 / Prompt 大改 / 工具链变更时，必须先跑 `npm run test` 全量
- 常规准出执行 `npm run test:quality`；Windows Nitro 真实进程与导入链路另跑 `npm run test:smoke`
- 每月 review 一次排除项，重新评估

---

**维护**：Mavis · **审核**：待产品 / 研发签字 · **下次评审**：每次大版本前
