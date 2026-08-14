# 测试范围与用例设计说明

> 基于 [test-scope-case-designer](../README.md) skill 的标准模板。本文档是 CAP_Agent
> 项目的"测什么、测到多深、为什么这样测"的唯一事实源。

## 1. 变更摘要

- 项目：链航智能获客中台 PoC（logistics-acquisition-poc / 内部代号 CAP_Agent）
- 范围：Nuxt 3 全栈 PoC，6 段式客户旅程（建档 → 画像 → 匹配 → 建联 → 回复判断 → 交接）
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
| Agent 5 模式 schema | 契约 | 全量边界 + 6 枚举全量通过 + fit_score coerce + intent×confidence 矩阵 | P0 | 单元 | Mavis | `agent-schemas.test.ts` (87) |
| 模型输出 JSON 解析层 | 合同 | Markdown 包裹 / 前置废话 / 数组拼接 / 缺 JSON / 大小写不敏感 / dead branch 锁定 | P0 | 单元 | Mavis | `parse-json-response.test.ts` (16) |
| reply_qualification | 功能 | 全 intent × 边界 | P0 | 单元 | Mavis | `agent-reply-qualification.test.ts` (15) |
| Agent 任务生命周期 | 功能 | 创建/停止/状态机/留痕/级联 | P0 | 单元 | Mavis | `agent-lifecycle.test.ts` (18) |
| Agent 任务端点边缘 | 契约/状态 | 同 target 多 mode 互不串 / stop 终态幂等 / stop 后可重建 / task 起步 + stop step 留痕 / HTTP dedup 一致性 | P0 | 单元 | Mavis | `agent-tasks-edge.test.ts` (10) |
| useDemoState composable | 前端契约 | refresh 防抖/quiet/通知维护/同数据不替换 / state 替换 / 错误退化链 / task 状态多分支 | P0 | 单元 | Mavis | `use-demo-state.test.ts` (31) |
| state.get 端点 | 接口 | shape + counts + 排序 + emailAllowlist 解析边界 | P0 | 单元 | Mavis | `state-endpoint.test.ts` (30) |
| demo action 14 分支 | 功能 | 异常 + 边界 + 业务规则 | P0 | 单元 | Mavis | `demo-actions-workflow.test.ts` (41) |
| Agent 上下文构造 5 mode | 合同 | 不存在客户/不存在机会/contact_id 缺失退化/operator_input 透传/timeline 30 截断/published 过滤/全未发布空数组 | P0 | 单元 | Mavis | `agent-context-and-result.test.ts` (10) |
| Agent 结果落库 5 mode | 副作用 | customer_type 写回/stage 推进与不降级/events/BY004 不落库/accepted 保护/未发布抛错/missing_contact/英文不升 stage/事务/4 intent × blocker/legacy 字符串/事件含 recommended_product | P0 | 单元 | Mavis | `agent-context-and-result.test.ts` (19) |
| Agent registry 合同 | 合同 | 5 mode key 完整 / 6 类型与 schema enum 同步 | P0 | 单元 | Mavis | `agent-context-and-result.test.ts` (2) |
| markNonAcceptedMatchesStale 边界 | 合同 | 无 match noop / 全 accepted 保护 / 非 accepted 全 stale / 自定义 now / 默认 demoNow / 多次幂等 / 不传 db / 不存在客户 noop | P0 | 单元 | Mavis | `mark-non-accepted-matches-stale.test.ts` (8) |
| advance-time 跟进提醒 | 功能 | 首次/二次/暂停/不触发 | P0 | 单元 | Mavis | `advance-time-reminders.test.ts` (14) |
| state.get 端点 | 接口 | shape + counts + 排序 | P0 | 单元 | Mavis | `state-endpoint.test.ts` (22) |
| agent tasks HTTP | 接口 | zod 校验 + dedup + stop | P0 | 集成 | Mavis | `agent-tasks-endpoint.test.ts` (19) |
| 官网 quote/identity/rematch | 接口/安全 | 主链路 + 会话隔离 + 原子校验 + 注入 | P0 | 集成 | Mavis | `website-journey.test.ts` (35) |
| 官网产品推荐 | 规则/边界 | published + Top3 + 路线/货类/能力/偏好计分 + 空表/无 published/全 bonus 98 上限/无 cityCountryMap/并列稳定排序/阈值边界 | P0 | 单元 | Mavis | `website-recommendations.test.ts` (11) |
| Opportunity 9 阶段常量 | 合同 | 长度/顺序/关键索引（5/6/8）/as-const tuple | P0 | 单元 | Mavis | `opportunity-stages.test.ts` (6) |
| 有效建联联系人 | 合同 | null 防御 / status 枚举 + 大小写 / email whitespace + 真值表 | P0 | 单元 | Mavis | `is-valid-outreach-contact.test.ts` (20) |
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
| NFR 域补缺（representative 落地，**已实现 2026-08-11**） | 性能/可用性/安全/韧性/可观测/数据完整性/成本/流程 7 域 31 条 | 见 history/2026-08-11-nfr-scope/representative-cases-2026-08-11.md | P0 | nfr-evidence 扩 / nfr-resilience / nfr-security / nfr-observ / nfr-data / nfr-cost / doc-contracts（6 新 + 1 扩） | DRAFT（待 PR review） | `tests/integration/nfr-{evidence,resilience,security,observ,data,cost}.test.ts` + `tests/unit/doc-contracts.test.ts`；31 条已实跑（实际 53 个 it，含 it.each 展开） |
| callModel 真 API 路径契约（**2026-08-14**） | API 合同 | openai-compatible mode → `response_format=json_object` + `temperature`；deepseek + thinking=enabled → `thinking` 字段 + `reasoning_effort`、**不**发 `response_format`；deepseek + thinking=disabled → `temperature`、无 `thinking` / 无 `response_format`；`finish_reason="length"` → task=failed + 错误提示 "模型输出达到长度上限"；空 content → task=failed + 错误提示 "没有返回业务结果" | P0 | 单元（mock `openai`） | Mavis | `tests/unit/agent-callmodel-real.test.ts` (5) |
| import-xlsx 错误/兜底路径（**2026-08-14**） | 边界 | 缺 domain/country 的行 → 跳过去重并正常创建 | P0 | 集成 | Mavis | `tests/integration/import-xlsx.test.ts` (+1: IMPORT-XLSX-020) |

> 数字 = 当前用例数；总计 615 条确定性单元/集成（2026-08-07 → 2026-08-11 +127 → 2026-08-14 +4 → 2026-08-14 +2 REAL-005 + XLSX-020）+ 100 条离线评测数据 + 2 条 Windows Nitro smoke。
> 2026-08-14 二次全量审计（10:32）：基于 fresh `coverage-final.json`（10:28 跑），发现 L336 / L40 是真 gap；L18/L20 经实测是 **dead-by-library**（xlsx.write 自带 check_wb 拒绝 0-sheet workbook，xlsx.read 的 SheetNames/Sheets 一一对应），转入 §4 排除项；REAL-005 + IMPORT-XLSX-020 落地，agent.ts branch → 100%（除 §4 排除项）、customers.post.ts branch 提升；§4 补 12 行次级排除（防御性 ?? 兜底 / v8 instrument artifact / 错误路径 / dead-by-library），测试文件 40 → 40（沿用现有文件）。
> 2026-08-14 首次实现：1 个新单测文件 `agent-callmodel-real.test.ts`（4）锁住 callModel 真 API 路径契约（openai-compatible vs deepseek 请求体差异 + finish_reason=length 错误处理 + 空 content 错误处理）；测试文件 39 → 40；新增 1 行 scope_policy 排除项记录 + 5 行未覆盖代码依据。
> 2026-08-11 实现：6 个新 NFR 文件 + 1 个扩；测试文件 33 → 39；NFR 域覆盖 4 → 7。
>
> **2026-08-07 更新**：按 5 skills 流水线 + grill-me 5 候选全留的判定，补 2 个新文件 + 扩 1 个文件，共 +47 条（435 → 482），单测文件 22 → 24（按 `Get-ChildItem tests/unit` 实际计数；前 8/4-8/6 累计链与目录差 3 文件未追溯，下一次评审核对）：
> - 新建 `tests/unit/agent-context-and-result.test.ts`（31）：`buildTargetContext` 5 mode 合同级（不存在客户/不存机会/contact_id 缺失退化/operator_input 透传/timeline 30 截断/published 过滤/全未发布空数组）+ `applyAgentResult` 5 mode 副作用（customer_type 写回/stage 推进与不降级/profile_completed 事件/BY004 不落库/accepted 保护/未发布抛错/missing_contact/英文不升 stage/事务/4 intent × blocker/legacy 字符串透传/事件含 risks·nextSteps·recommended_product）+ `getAgentSchemas` & `getAgentCustomerTypes` registry 合同（5 mode key 完整 / 6 类型与 schema enum 同步）
> - 新建 `tests/unit/mark-non-accepted-matches-stale.test.ts`（8）：直击 `markNonAcceptedMatchesStale` 边界（无 match noop / 全 accepted 保护 / 非 accepted 全 stale / 自定义 now / 默认 demoNow / 多次调用幂等 / 不传 db / 不存在客户 noop）
> - 扩 `tests/unit/demo-actions-workflow.test.ts`（28 → 34，+6）：补 `set_contact` 5 个分支（opp 不存在 404 / contact 不存在 404 / 跨客户 404 / 非 contactable 400 / 成功路径含 event 与 outreach_drafting 任务触发）+ `confirm_next_action` 部分更新语义（只传 nextAction 时 due_at/owner/blocker 保持原值）
>
> **2026-08-06 更新**：按 5 skills 流水线对高价值纯函数/边界补 +61 条（374 → 435），单测文件 18 → 19：
> - 新建 `parse-json-response.test.ts`（16）：模型输出 JSON 解析层（`parseJsonResponse`）的间接契约——Markdown 包裹 / 前置废话 / 数组拼接（call site dead branch 锁定）/ 缺 JSON / 大小写不敏感 / 数字/null/数组不走 parseJsonResponse 而被 schema 拒绝
> - `agent-schemas.test.ts`（65 → 87，+22）：6 个 customer_type 枚举全量通过 + 6×3 矩阵 + `fit_score` coerce（数字/字符串数字/浮点/非数字）+ outreach_drafting language 默认值/falsy 退化 + reply_qualification 4 intent × 3 confidence 矩阵
> - `use-demo-state.test.ts`（16 → 31，+15）：state 替换 vs 保留（避免浮层重渲染）/ 错误退化链 data.statusMessage→statusMessage→默认 / task 出现不触发 Notification / completed↔running 不会触发
> - `state-endpoint.test.ts`（22 → 30，+8）：emailAllowlist undefined/空串/仅空白/仅逗号/尾随逗号/无 case 归一 边界
>
> **2026-08-05 更新**：按 5 skills 流水线 + GitHub `codex/AHa-testing` 分支比对，补 2 个新单元文件（`opportunity-stages` / `is-valid-outreach-contact`）+ `website-recommendations` 扩 6 条边界用例，共 +32 条（342 → 374），单测文件 16 → 18。补的是 9 阶段常量合同、纯函数聚焦单测、推荐引擎空表/全 bonus 98 上限/阈值边界等高价值覆盖。
>
> **2026-08-04 更新**：按 codex/AHa-testing 分支新加 3 个单元测试文件（`db-utils` / `agent-tasks-edge` / `use-demo-state`）+ import-xlsx 追加 4 条边界，共 +42 条用例（300 → 342）。同步补齐之前 §3 漏列的 3 个旧文件（`product-publish` / `demo-action-stale` / `handoff-legacy`）以让清单与实际 22 文件对齐。

## 4. 排除项与假设

> **2026-08-11 更新**：NFR 域补缺盘点已立项为 `history/2026-08-11-nfr-scope/scope-decision-2026-08-11.md`（scope_only 模式，DRAFT 状态）；§1.3 列 6 项待决策（性能基线 / 韧性降级是否纳入 PoC / 安全纵深优先级 / 用户旅程级性能范围 / 真实模型接入前 NFR 准备 / 排除项重新评估 owner）。本节既有排除项与"重新评估条件"列保持不变；NFR 域未关闭的缺口见该决定 §3 / §5。

> 本表与 `docs/history/2026-08-13-exclusion-review/scope-exclusion-review-2026-08-13.md` §4 互补登记（**两表不重叠**：本表是代码层 21 项，scope-excl §4 是业务层 19 项）。本表 1-6 沿用 scope-excl §4 1-6；7-21 是 8/14 二次审计代码层新增；#22 #23 跨表引用 scope-excl §4 18-19 真缺口。时间窗为 DRAFT 草案，#22 #23 待 §1.4 owner 指定后回填。

| # | 排除项 | 来源 | 原因 | 责任人 | 重新评估条件 | 时间窗（草案）|
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | 真实 LLM 端到端评测 | docs §4 既有（沿用 scope-excl §4 1）| PoC 不接生产模型，CI 跑确定性测试 | Mavis | 接入真实模型时启用 `agent-evaluation/*` | 战略 ≤ 90 天 |
| 2 | UI 自动化（Playwright） | docs §4 既有（沿用 scope-excl §4 2）| 演示系统只在 Chrome 演示，单浏览器 | Mavis | 进入长期版本或回归频繁时评估 | 战略 ≤ 90 天 |
| 3 | 性能压测 | docs §4 既有（沿用 scope-excl §4 3）| PoC 30 + 8 + 3 客户量级，无性能风险 | Mavis | 客户数 >1000 或服务化时 | 即时 ≤ 7 天 |
| 4 | 真实 WCA 抓取 | docs §4 既有（沿用 scope-excl §4 4）| 项目明文"不抓取真实 WCA 目录" | Mavis | 永远排除 | 永久 |
| 5 | 国际化 i18n | docs §4 既有（沿用 scope-excl §4 5）| 文案以中文为主，英文邮件由 Agent 生成 | Mavis | 多语种支持立项 | 战略 ≤ 90 天 |
| 6 | 跨浏览器兼容 | docs §4 既有（沿用 scope-excl §4 6）| 仅 Chrome 演示 | Mavis | 客户端版本立项 | 战略 ≤ 90 天 |
| 7 | 前端 Vue SFC（components / layouts / pages） | docs §4 8/14 二次审计新增 | vitest config 不 include `.vue`；PoC 演示由人工操作员，UI 行为不是 PoC 关键不变量 | Mavis | 客户端版本立项或增加 e2e 框架时纳入 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 8 | `useDemoState` 客户端副作用（L17-26 Notification / L81-104 setInterval 轮询） | docs §4 8/14 二次审计新增 | 浏览器 only（`import.meta.client` / `document.*` / `window.setInterval`）；`use-demo-state.test.ts` 用 `import.meta.client=false` + stub 隔离；业务契约由 `state-endpoint` / `agent-tasks-endpoint` 间接锁 | Mavis | 增加 jsdom / happy-dom 集成测试或 Playwright 时纳入 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 9 | `agent.ts` L300-311 `systemPrompt`（5 mode prompt 字符串模板） | docs §4 8/14 二次审计新增 | 纯字符串拼接，不是 logic；prompt 行为由 `agent-evaluation/core-regression.json` 100 用例锁定 | Mavis | 引入 prompt 单元化模板或 prompt version 概念时纳入 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 10 | `agent.ts` L348-350 `response.usage` 三字段 / L347/L351 ternary | docs §4 8/14 二次审计新增 | v8 instrument 对行内对象属性 reporting 偏差（REAL-001 mock 显式传了 `prompt_tokens/completion_tokens/total_tokens` 已走过两条 arm） | Mavis | v8 升级或换 istanbul 时重新评估 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 11 | `agent.ts` L523-524 `setTimeout(() => runTask(id, config), 40)` 调度 | docs §4 8/14 二次审计新增 | `setDeferAgentExecutionForTests(true)` 完全绕过；`runAgentTaskNow` 替代测试入口 | Mavis | 调度策略变更（如改 setImmediate / queue）时纳入 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 12 | `parseJsonResponse` Array 分支（L216-218） | docs §4 8/14 二次审计新增 | `parse-json-response.test.ts` PJR-014 显式锁定为 dead branch（callModel 当前只对 string 调 parseJsonResponse） | Mavis | callModel 改为对数组也调 parseJsonResponse 时重新评估 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 13 | `agent.ts` 防御性 `??` 兜底（L199/203/205/240-242/253-255/279-280/285-287/291/475 / L215 string-arm / L335/L347/L351/L502 / L322-323 LLM endpoint 配置守卫） | docs §4 8/14 二次审计新增 | DB / JSON.parse / 字段填充 / error instanceof Error / LLM endpoint config 防御性分支；happy path + 现有大量业务测试间接锁 | Mavis | DB schema 改 NOT NULL + 默认值 / OpenAI SDK 升级 / error 抛出规范统一时重评 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 14 | `action.post.ts` 防御性 `JSON.parse(x / '{}')` / `String(x / '')` 兜底（L21/22/31/49/50/60/79/93/116） | docs §4 8/14 二次审计新增 | 同上模式：业务契约由 happy path + `demo-actions-workflow.test.ts` (41) 间接锁 | Mavis | 同上 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 15 | `state.ts` L5 `parseJson` falsy 兜底 / L98 `product ? : undefined` 防御性 guard | docs §4 8/14 二次审计新增 | `state.ts` parseJson 在所有 `*_json` 列上调用；fallback 路径仅在列 NULL 时触发 | Mavis | DB schema 改 NOT NULL 时重评 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 16 | `identity.post.ts` L20/42 `JSON.parse(x / '{}')` 兜底 / L27 `email.split('@')[1] / ''`（zod `.email()` 已保证有 `@`） | docs §4 8/14 二次审计新增 | 防御性分支；L27 实际不可达 | Mavis | 去掉 zod email 校验或允许非标准邮箱时重评 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 17 | `rematch.post.ts` L31 `JSON.parse(customer.facts_json  /  '{}')` 兜底 | docs §4 8/14 二次审计新增 | 防御性分支 | Mavis | 同上 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 18 | `website.ts` L16-18 `JSON.parse(product.x_json  /  '[]')` 兜底 / L23 OR 第二段 `destination.includes(tail)` | docs §4 8/14 二次审计新增 | 防御性 nullish；L23 因 seed 路线 `normalized.includes(destination)` 总为 true 而被 OR 短路未求值（v8 artifact，行为正确） | Mavis | seed 路线改为无 `-` 分隔 / v8 升级时重评 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 19 | `db.ts` L193 WAL fail catch / L206 `databasePath  /  default` / L246 `JSON.parse(pms_snapshot) catch` / L295-298 resetDemoDatabase rollback | docs §4 8/14 二次审计新增 | 环境/配置错误路径；需 host WAL reject / 空 config / 损坏 snapshot / seed 步骤抛错才能触发；副作用大于价值 | Mavis | 增加故障注入框架（chaos / DB mock）时纳入 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 20 | `customers.post.ts` L18 `Workbook has no worksheets` / L20 `worksheet unavailable` xlsx 错误路径 | docs §4 8/14 二次审计新增 | **dead-by-library**：`XLSX.write` 自带 `check_wb` 拒绝写 0-sheet workbook（throw "Workbook is empty"），`XLSX.read` 返回的 SheetNames/Sheets 一一对应；L18/L20 在合法 xlsx 输入下不可达。catch 路径由 IMPORT-XLSX-012b（malformed zip）覆盖 | Mavis | xlsx 库大版本升级时重评 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 21 | `customers.post.ts` L40 `domain && country ? SELECT : null` 兜底 | docs §4 8/14 二次审计新增 | 缺 domain/country 时跳过去重（业务期望"无标识就不去重"）；由 IMPORT-XLSX-020 锁定 | Mavis | 业务规则改为"严格去重"时重评 | 战略 ≤ 90 天（DRAFT — 触发器类型：环境/工具）|
| 22 | **性能基线数字（CP0 对象）** | scope-excl §4 行 18 真缺口（待 owner）| 无 project_approved 阈值；任何阈值都需产品 / 研发 / SRE 联合签字 | 待指定（推荐 SRE + 研发）| 产品 + 研发 + SRE 联合评审后启用 | 待 owner 指定 |
| 23 | **NFR 排除项重新评估机制本身** | scope-excl §4 行 19 真缺口（待 owner）| 文档写"每月 review 一次"无 owner；长期遗漏 | 待指定（推荐 测试治理 owner）| 用户对 §1.4 第 2 项决策后启动 | 待 owner 指定 |

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
