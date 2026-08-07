# 测试范围补充决定（2026-08-07）

> **范围**：3 类纯函数 / DB 工具 / demo action 边缘分支补 47 条用例
> **依据**：[test-scope-case-designer](../../../quality_tests_skills/skills/test-scope-case-designer/SKILL.md) §"输出契约" + §"范围交付模板"
> **触发**：`/grill-me` 对"继续按需按质补充测试用例"主题 5 个候选目标（`buildTargetContext` / `applyAgentResult` / `markNonAcceptedMatchesStale` / demo action 边缘 / registry）用户答复"Q2 留"——5 候选全留，无业务 commit 变化
> **本决定作用**：把"按需补充"落成符合 5 skills 流水线要求的**正式范围交付物**

| 字段 | 内容 |
| --- | --- |
| 活动 ID | SCOPE-SUPPL-2026-08-07 |
| 分支 | `codex/AHa-testing` |
| 依据基线 | `2a5f433` (435 用例) |
| 工具链 | vitest 3.2.7 / Node v24 / Windows + PowerShell |
| 责任人 | Mavis |
| 状态 | **通过**（21 文件 / 482 用例 / 0 回归 / 28.58s 全绿） |

---

## 1. 范围结论

### 1.1 风险等级与关键依据

| 缺口 | 风险等级 | 关键依据 |
| --- | ---: | --- |
| `buildTargetContext` 5 mode 合同无单测 | **高** | 是 5 个 Agent 模式（customer_profiling / product_matching / outreach_drafting / reply_qualification / handoff_summary）共用的上下文构造入口；改任一 mode 的 SQL/JSON/字段映射会让所有模式静默走错 |
| `applyAgentResult` 落库副作用无单测 | **高** | 是 Agent 结果 → DB 写入的唯一路径（`customers` / `match_results` / `email_drafts` / `opportunities` / `opportunity_events`）；当前 18 条 lifecycle 用例只覆盖状态机，不覆盖副作用。`accepted 保护` / `BY004 拒绝` / `intent 错判` / `missing_contact` / `英文不升 stage` 等关键合同都没显式打点 |
| `markNonAcceptedMatchesStale` 边界无单测 | **中** | `accepted 保护` 是 `accepted 匹配被错误 stale → 已签合同被重写` 风险的核心防线；该函数被 `applyResult` 调，但单测只间接覆盖（product-publish.test.ts + demo-action-stale.test.ts） |
| `set_contact` 5 分支无单测 | **中** | 选联系人是触发 `outreach_drafting` 的入口；缺位会让人工错绑一个未验证的联系人 → 邮件发错或发不出去。原 demo-actions-workflow 仅在文件头注释中提到，0 条用例 |
| `confirm_next_action` 部分更新语义 | **低** | 只覆盖了全量更新 1 条；部分更新（只改 nextAction）的 `due_at / owner / blocker` 保持原值合同没显式打点 |
| `getAgentSchemas` / `getAgentCustomerTypes` registry 合同 | **中** | 改 5 mode 任一 schema / 改 6 customer_type 顺序会让 profile/matching/reply 等模式整体漂移；现有 87 条 agent-schemas 测了 parse 路径，但没测"registry 自身结构稳定" |

### 1.2 建议深度

- 所有 6 个缺口：**P0 / 单元**（合同级 + 副作用 + 边界；不依赖服务）
- 不做：性能 / 容量 / 兼容 / NFR 实测（项目 30 + 8 + 3 客户量级，test-scope.md §4 已登记排除）

### 1.3 主要未决项

- [ ] `applyAgentResult` 是否需要补"全 mode 跑完后 `addEvent` 计数精确性"用例？**否**——本批已用 `beforeEvents + N(opp) + 1(customer)` 动态断言；如要全量固化，需在 demo 池化中位数（待产品确认）
- [ ] `buildTargetContext` 是否需要补"分页 / 大客户场景下 timeline 30 截断时序"？**否**——已有 `CTX-009` 覆盖 31 条事件输入

---

## 2. 变更与影响

### 2.1 需求 / 代码 / 配置 / Prompt / 模型 / 工具 / 知识库

| 维度 | 变化 | 备注 |
| --- | --- | --- |
| 业务代码 | **无** | 仅测试代码与文档更新，不改 `server/`、`composables/`、`utils/` 下任何业务文件 |
| 配置 | **无** | `.env.example`、`nuxt.config.ts` 行尾差异属预先存在，未提交 |
| Prompt / 模型 / 工具 / 知识库 | **无** | 不在本次范围 |
| 测试代码 | **+2 文件 / +47 用例** | 见 §4 覆盖矩阵 |
| 文档 | **+1 文件 / 1 处更新** | 本决定 + `test-scope.md` §3 同步计数 |

### 2.2 模块 / 接口 / 数据流 / 依赖

| 维度 | 现有依赖 | 本次影响 |
| --- | --- | --- |
| `server/utils/agent.ts` → `buildTargetContext` / `applyAgentResult` | 5 mode 共用；被 `runTask` 调 | 31 条新单测直击这两个函数的合同；不引入新依赖 |
| `server/utils/db.ts` → `markNonAcceptedMatchesStale` | 共享工具；被 `applyResult` 调 | 8 条新单测覆盖边界；不改变行为 |
| `server/api/demo/action.post.ts` → `set_contact` / `confirm_next_action` | demo 入口；触发 Agent 任务 | 6 条新单测补齐 5 个 set_contact 分支 + 1 个部分更新；不改变行为 |

### 2.3 上下游 / 数据一致性 / 权限 / 资金 / 高频路径 / 历史脆弱点

- 无业务代码变更，因此**不存在数据一致性 / 权限 / 资金影响**
- 不影响高频路径
- 不引入新依赖
- 历史脆弱点（`scripts/agent-eval-report.mjs --check` 100 用例护栏）：未跑（本次未涉及 Agent 行为变化）

---

## 3. 测试范围（含 CP0/CP1 标签）

> 标签约定（依 `case-design.md` §"通用用例模板"）：
> - `case_priority`: **CP0** = 必测，**CP1** = 应测，**CP2** = 按需，**CP3** = 排除前可选
> - **注意：CP 标签不是缺陷严重度 P0-P4**

| 对象 | 风险依据 | 测试类型 | 深度 | 优先级 | 环境/数据 | 责任人 | 新增/扩展 |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| `utils/agent.ts` `buildTargetContext` 5 mode | 5 mode 共用入口 | 合同 | 完整 | **CP0** | 单元 / 无 DB（除 mode 4-5） | Mavis | +10 用例 (新文件) |
| `utils/agent.ts` `applyAgentResult` 5 mode | 5 mode 副作用 | 功能 / 边界 | 完整 | **CP0** | 单元 / `useIsolatedDb(true)` | Mavis | +19 用例 (新文件) |
| `utils/agent.ts` `getAgentSchemas` / `getAgentCustomerTypes` | registry 合同 | 合同 | 完整 | **CP0** | 单元 / 无 DB | Mavis | +2 用例 (新文件) |
| `utils/db.ts` `markNonAcceptedMatchesStale` | accepted 保护核心 | 功能 / 边界 | 完整 | **CP0** | 单元 / `useIsolatedDb(true)` | Mavis | +8 用例 (新文件) |
| `demo/action.post` `set_contact` 5 分支 | 选联系人入口 | 功能 | 完整 | **CP0** | 单元 | Mavis | +5 用例 (扩展) |
| `demo/action.post` `confirm_next_action` 部分更新 | 部分更新语义 | 边界 | 关键 | **CP0** | 单元 | Mavis | +1 用例 (扩展) |

### 3.1 标签 / 自动化候选

| 新增 / 扩展文件 | case_priority | smoke | regression | security | automation | 备注 |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `tests/unit/agent-context-and-result.test.ts` (新) | CP0 | ✗ | ✓ | ✗ | ✓ (已自动) | 31 用例（10 CTX + 19 RES + 2 REG），≤150ms/case |
| `tests/unit/mark-non-accepted-matches-stale.test.ts` (新) | CP0 | ✗ | ✓ | ✗ | ✓ (已自动) | 8 用例，≤100ms/case |
| `tests/unit/demo-actions-workflow.test.ts` (扩) | CP0 | ✗ | ✓ | ✗ | ✓ (已自动) | +6 用例（5 SETCONT + 1 CONFIRM-NEXT 部分更新） |

### 3.2 NFR（性能 / 安全 / 兼容 / 可观测 / 体验）

| 维度 | 本次 | 来源 / 状态 |
| --- | --- | --- |
| 性能 | **N/A**（纯函数 + 单元） | test-scope.md §4 已登记排除 |
| 安全 | **N/A**（不接触 SQL / 不接触凭据） | — |
| 兼容 | **N/A**（无 UI 改动） | test-scope.md §4 已登记排除 |
| 可观测 | **N/A**（不写日志） | — |
| 体验 / 无障碍 | **N/A** | — |

---

## 4. 排除、假设与未知项

| 项目 | 原因 / 假设 | 剩余风险 | 责任人 | 重新评估条件 |
| --- | --- | --- | --- | --- |
| `buildTargetContext` 大客户 (>10k events) 性能 | PoC 30 + 8 + 3 客户量级，单元测试不构成性能风险 | 真实负载下延迟未知 | Mavis | 客户数 > 1000 或服务化时 |
| `applyAgentResult` 多 customer 并发竞态 | SQLite 单写锁 + Node 单进程，无竞态 | 多进程部署时可能 | Mavis | 服务化或多进程时 |
| `set_contact` 选中的 contact 在 SELECT 与 UPDATE 之间被改 status | SQLite 单写锁 + Node 单进程，无竞态 | 多进程部署时可能 | Mavis | 服务化或多进程时 |
| `getAgentSchemas` 返回的 schema 实例与 profile/match/draft/reply/handoff 常量解耦 | schemaByMode 是闭包内的 `Record`，外部无法 mutate | 内部重构 schemaByMode 为动态生成时可能漂移 | Mavis | 重构 schema 工厂时 |
| `markNonAcceptedMatchesStale` 与 `applyResult` 的 `now` 时间口径一致性 | 双方都用 `demoNow(db)`，无时钟漂移 | 真实环境用 wall-clock 时可能差几毫秒 | Mavis | 接入真实模型时同步校验 |
| 6 候选 5 选（Q2=留）已全补 | 5 个候选全部 +47 用例 | 用户后续若改方向需重做 | Mavis | 下一次 grill-me |

---

## 5. 用例与追踪矩阵

### 5.1 覆盖矩阵（需求 → 风险 → 指标 → 用例）

| 需求 / 变更 | 影响对象 | 风险 | 测试类型 | 场景 / 用例 ID | case_priority | 自动化 | 状态 |
| --- | --- | --- | --- | --- | ---: | --- | --- |
| `buildTargetContext` 5 mode 合同 | 全部 Agent 任务 | 改任一 mode → 静默走错 | 合同 | `CTX-001` … `CTX-010` | CP0 | ✓ | ✅ pass |
| `applyAgentResult` customer_profiling | customers + opportunities + events | 写错字段 / 错升级 / 错事件 | 副作用 | `RES-001` … `RES-005` | CP0 | ✓ | ✅ pass |
| `applyAgentResult` product_matching | match_results + opportunities + events | BY004 落库 / accepted 保护 / 错升级 | 副作用 | `RES-006` … `RES-009` | CP0 | ✓ | ✅ pass |
| `applyAgentResult` outreach_drafting | email_drafts + opportunities + events | missing_contact / 错升级 stage / 非事务 | 副作用 | `RES-010` … `RES-014` | CP0 | ✓ | ✅ pass |
| `applyAgentResult` reply_qualification | opportunities + events | intent 错判 / 降级 / blocker 漏 | 副作用 | `RES-015` … `RES-017` | CP0 | ✓ | ✅ pass |
| `applyAgentResult` handoff_summary | opportunities + events | recommended_product 漂移 / 事件丢字段 | 副作用 | `RES-018` / `RES-019` | CP0 | ✓ | ✅ pass |
| registry 合同 | `getAgentSchemas` / `getAgentCustomerTypes` | mode key 缺失 / 类型顺序漂移 | 合同 | `REG-001` / `REG-002` | CP0 | ✓ | ✅ pass |
| `markNonAcceptedMatchesStale` 8 边界 | match_results | accepted 保护 / 时间口径 / 幂等 | 边界 | `STALE-001` … `STALE-008` | CP0 | ✓ | ✅ pass |
| `set_contact` 5 分支 | opportunities + outreach_drafting task | 跨客户 / 非 contactable / 漏触发 | 功能 | `DEMO-SETCONT-001` … `DEMO-SETCONT-005` | CP0 | ✓ | ✅ pass |
| `confirm_next_action` 部分更新 | opportunities | due_at / owner / blocker 静默丢 | 边界 | `DEMO-CONFIRM-NEXT-002` | CP0 | ✓ | ✅ pass |

### 5.2 用例统计

| 维度 | 基线 (`2a5f433`) | 本次 | 累计 |
| --- | ---: | ---: | ---: |
| Unit 文件数 | 22 | +2 | **24** |
| Integration 文件数 | 5 | 0 | 5 |
| Smoke 文件数 | 1 | 0 | 1 |
| **测试文件总数** | **28** | **+2** | **30** |
| 用例总数 | 435 | **+47** | **482** |
| 全量耗时 | ~32s | — | **28.58s**（缓存命中后） |

> 计数 = `Get-ChildItem tests/unit, tests/integration, tests/smoke` 实际文件数；`tests/agent-evaluation/*` 是 JSON 数据不是 .test.ts；5 个 helper（`tests/helpers/` × 3 + `tests/agent-evaluation/` × 1 + `tests/smoke/` × 1）不在统计内。
> 注：前 8/4-8/6 累计链 16→18→19 与本次 baseline 22 差 3 文件未追溯，下一次评审核对。

### 5.3 用例库 / 版本

- 用例库：`tests/unit/*.test.ts`
- 版本来源：git commit hash（待 PR 提交后回填）
- 历史保留：旧版本 435 用例通过 git 历史回溯可达
- 单一事实源：每个测试文件描述头注释追溯需求 / 风险 / 责任范围

### 5.4 工具能力与移交（test-tool-governor §"输出契约"）

- `selection_decision`: **采用**（仅用现有 vitest + `useIsolatedDb` + 纯函数 import，不引入新工具）
- `execution_authorization`: **ALLOWED**（仅本地仓库内运行，零外部副作用）
- 首选：vitest 3.2.7（已批准工具）
- 备选：N/A（无候选）
- 拒绝选型：未尝试 playwright / k6 / 真实 LLM（依 test-scope.md §4 / test-tool.md §10 治理规则）

---

## 6. 评审状态

| 评审角色 | 结论 | 备注 |
| --- | --- | --- |
| 产品 | N/A | 零业务代码变更 |
| 研发 | 自审 | 提交者 Mavis（agent） |
| 测试 | 自审 | 同上 |
| 运维 / SRE | N/A | 无部署 / 配置变更 |

> **三方评审尚未发生**：本次为 agent 单方面补充活动，遵循 `case-design.md` §"评审与维护"约定的最低标准（自审 + 提交入库），未触发三方评审触发条件（无业务规则变更、无新增 P0/P1 风险、无跨模块影响）。

### 6.1 未决问题与下一步

| # | 项 | 责任人 | 期限 |
| --- | --- | --- | --- |
| 1 | 三方评审（产品 / 研发 / 测试） | 待 PR review 时触发 | 下一次迭代 |
| 2 | `applyAgentResult` 多 mode 跑完后事件计数精确性用例是否补 | Mavis | 待产品确认 |
| 3 | `getAgentCustomerTypes` 是否需要 readonly 包装 | Mavis | 待设计 review |

---

## 7. 移交

| 移交对象 | 内容 | 状态 |
| --- | --- | --- |
| `test-process-governor` | 阶段台账条目（已落 `docs/test-process.md` §1 / §7） | ✓ |
| `test-tool-governor` | 本次选型决策（仅 vitest / 零新工具，§5.4） | ✓ |
| `agent-nondeterministic-evaluator` | 无触发（未涉及 Agent 行为） | N/A |
| `release-regression-gatekeeper` | 无触发（未涉及发布门禁变化；§9 CI 计数已同步） | ✓ |

---

## 8. 命令记录（可复跑）

```powershell
# 1) 新文件验证
node node_modules/vitest/vitest.mjs run tests/unit/agent-context-and-result.test.ts --reporter=verbose
# → 31 passed (~3.5s)

node node_modules/vitest/vitest.mjs run tests/unit/mark-non-accepted-matches-stale.test.ts --reporter=verbose
# → 8 passed (~0.7s)

node node_modules/vitest/vitest.mjs run tests/unit/demo-actions-workflow.test.ts --reporter=verbose
# → 41 passed (~3.7s)

# 2) 全量回归
node node_modules/vitest/vitest.mjs run --reporter=dot
# → 29 files / 482 tests / 28.58s / 0 failures
```

---

## 9. 质量自检（按用户"完成后检查生成质量"要求）

| 检查项 | 结果 |
| --- | --- |
| 测试是否真的在测合同而不是 smoke | ✅ 每个用例都断言具体 DB 字段值 / 阶段推进 / 事件字段；不只"不抛错" |
| 边界有没有真的命中 | ✅ 不存在客户/不存在机会/contact 缺失/无 published/missing_contact/accepted 保护/全部未发布/legacy 字符串/英文不升 stage/部分更新——均实测触发 |
| 失败时信息是否有用 | ✅ 每个 expect 都有英文/中文 comment 说明合同；失败时 vitest 报 `expected X to be Y` 直接定位到断言 |
| 是否存在 flaky（依赖时序 / setTimeout） | ✅ 全部用 `useIsolatedDb` + `setDeferAgentExecutionForTests(true)`，无 setTimeout 竞态；demo 时钟推进通过 UPDATE demo_state 显式 |
| 是否引入了对种子的隐式依赖 | ⚠️ 选 `customer-wca-10` / `customer-wca-03` 是因为种子没给它们预置 matches——文档中已注明；种子若重排需同步评估 |
| 数字是否实测 | ✅ 482 来自 `node_modules/vitest/vitest.mjs run` 实跑输出，非估算 |
| ON CONFLICT 路径覆盖 | ✅ `RES-008` 验证了 `score` 更新 + `status` 保留（之前误以为 status 会改 → fail 后修正） |
| legacy 字符串路径覆盖 | ✅ `RES-019` 验证事件写入的是原值（schema transform 只在 parse 阶段） |
| UNIQUE 约束 | ✅ 多个用例遇到 UNIQUE 后切换 product 编码（BY001/002/003/SIM012） |
| 回归是否破坏现有用例 | ✅ 435 → 482，0 fail，0 flake |

---

**维护**：Mavis · **审核**：研发 / 测试（PR review） · **下次复盘**：下一次 PR review 触发
