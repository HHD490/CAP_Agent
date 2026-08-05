# 测试范围补充决定（2026-08-05）

> **范围**：3 处缺测点（9 阶段常量 / 纯函数聚焦 / 推荐引擎边界）补 32 条用例
> **依据**：[test-scope-case-designer](../../../quality_tests_skills/skills/test-scope-case-designer/SKILL.md) §"输出契约" + §"范围交付模板"
> **触发**：GitHub `HHD490/CAP_Agent@codex/AHa-testing` 分支基线 24 unit + 5 integration = 29 文件 / 342 用例 / 42.6s 全绿，但 **3 类覆盖缺口** 仍未关闭
> **本决定作用**：把"按需补充"从测试代码落成符合 5 skills 流水线要求的**正式范围交付物**

| 字段 | 内容 |
| --- | --- |
| 活动 ID | SCOPE-SUPPL-2026-08-05 |
| 分支 | `codex/AHa-testing` |
| 提交 | `7c2bf8b` |
| 依据基线 | `e3c006a` (342 用例) |
| 工具链 | vitest 3.2.7 / Node v24 / Windows + PowerShell |
| 责任人 | Mavis |
| 状态 | **通过**（26 文件 / 374 用例 / 0 回归） |

---

## 1. 范围结论

### 1.1 风险等级与关键依据

| 缺口 | 风险等级 | 关键依据 |
| --- | ---: | --- |
| 9 阶段常量合同缺失 | **中** | `opportunityStages` 被 `advance-time`（stage=6 触发跟进）/ `state.ts`（stage=5/8 计 humanTasks）/ `demo-action`（stage 推进与 focus 切换）三个模块隐式硬编码依赖。改顺序/改名会让上面三个模块**静默走错分支**，运营台账与漏斗计数同时失真 |
| `isValidOutreachContact` 纯函数单测缺失 | **中** | 该函数被 Agent `outreach_drafting` 模式 + `demo/action.post` + 前端 UI 共享；当前仅在集成测试 `demo-action-stale` 里附带 1 个 case，**纯函数合同与集成副作用未解耦**。一旦规则被改（status 串大小写、whitespace 集合），难以定位是 Agent 改的、demo 改的、还是前端改的 |
| `recommendProducts` 边界用例不足 | **中** | 官网产品推荐是给外部访客展示的第一道门面，**封顶合同（98）/空表退化/无 cityCountryMap 退化/并列稳定排序**都没显式测试。其中"全 bonus 叠加 98"是产品销售与运营最容易引争议的细节 |

### 1.2 建议深度

- 缺口 1 / 2：**P0 / 单元**（合同级、不依赖服务）
- 缺口 3：**P0 / 单元**（推荐引擎是公开可见规则，回归必须 100% 覆盖）
- 不做：性能/容量/兼容/NFR 实测（项目 30 + 8 + 3 客户量级，test-scope.md §4 已登记排除）

### 1.3 主要未决项

- [ ] 缺口 1 / 2 / 3 是否需要在 PR Review 中再增补？**当前 PR 已合并，等下一次迭代再评估**
- [ ] 是否补"5 个 Agent 模式的负面回归集"（promptfoo 集成回归）？**否**——属 `agent-nondeterministic-evaluator` 治理范畴，由 `tests/agent-evaluation/core-regression.json` 100 用例独立覆盖

---

## 2. 变更与影响

### 2.1 需求 / 代码 / 配置 / Prompt / 模型 / 工具 / 知识库

| 维度 | 变化 | 备注 |
| --- | --- | --- |
| 业务代码 | **无** | 仅测试代码与文档更新，不改 `server/`、`composables/`、`utils/` 下任何业务文件 |
| 配置 | **无** | `.env.example`、`nuxt.config.ts` 行尾差异属预先存在，未提交 |
| Prompt / 模型 / 工具 / 知识库 | **无** | 不在本次范围 |
| 测试代码 | **+3 文件 / +32 用例** | 见 §4 覆盖矩阵 |
| 文档 | **+1 文件 / 4 处更新** | 本决定 + `test-scope.md` / `test-tool.md` / `release-regression.md` / `agent-evaluation.md` 同步计数 |

### 2.2 模块 / 接口 / 数据流 / 依赖

| 维度 | 现有依赖 | 本次影响 |
| --- | --- | --- |
| `utils/opportunity.ts` → `advance-time.post` / `state.ts` / `demo-action.post` | 隐式硬编码 stage 数值 | 缺口 1 测试只读不写，不改变现有依赖 |
| `server/utils/contact.ts` → Agent / demo/action / 前端 | 共享纯函数 | 缺口 2 测试只读不写，不改变行为 |
| `server/utils/website.ts` → `quote.post` / `rematch.post` | 评分逻辑 | 缺口 3 测试只读不写，**不修改计分公式** |

### 2.3 上下游 / 数据一致性 / 权限 / 资金 / 高频路径 / 历史脆弱点

- 无业务代码变更，因此**不存在数据一致性 / 权限 / 资金影响**
- 不影响高频路径
- 不引入新依赖
- 历史脆弱点（`scripts/agent-eval-report.mjs --check` 100 用例护栏）：已重跑，exit 0

---

## 3. 测试范围（含 CP0/CP1 标签）

> 标签约定（依 `case-design.md` §"通用用例模板"）：
> - `case_priority`: **CP0** = 必测，**CP1** = 应测，**CP2** = 按需，**CP3** = 排除前可选
> - **注意：CP 标签不是缺陷严重度 P0-P4**

| 对象 | 风险依据 | 测试类型 | 深度 | 优先级 | 环境/数据 | 负责人 | 新增/扩展 |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| `utils/opportunity.ts` 9 阶段常量 | 隐式硬编码 3 处业务模块 | 功能 | 合同 | **CP0** | 单元 / 无 DB | Mavis | +6 用例 (新文件) |
| `server/utils/contact.ts` 有效联系人判定 | Agent + demo + 前端共享 | 功能 | 合同 | **CP0** | 单元 / 无 DB | Mavis | +20 用例 (新文件) |
| `server/utils/website.ts` 产品推荐 | 公开可见规则、封顶 98 是产品争议点 | 功能 / 边界 | 规则 + 边界 | **CP0** | 单元 / `useIsolatedDb(false)` | Mavis | +6 用例 (扩展) |

### 3.1 标签 / 自动化候选

| 新增文件 | case_priority | smoke | regression | security | automation | 备注 |
| --- | ---: | --- | --- | --- | --- | --- |
| `tests/unit/opportunity-stages.test.ts` | CP0 | ✗ | ✓ | ✗ | ✓ (已自动) | 6 用例，≤100ms |
| `tests/unit/is-valid-outreach-contact.test.ts` | CP0 | ✗ | ✓ | ✗ | ✓ (已自动) | 20 用例（含 it.each 展开 7 子项 + 9 真值表），≤100ms |
| `tests/unit/website-recommendations.test.ts` (扩 006-011) | CP0 | ✗ | ✓ | ✗ | ✓ (已自动) | 6 用例，~95ms/case |

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
| 性能压测 | PoC 30+8+3 客户量级，单元测试不构成性能风险 | 真实负载下延迟未知 | Mavis | 客户数 > 1000 或服务化时 |
| 跨浏览器兼容 | 仅 Chrome 演示 | 其他浏览器可能样式 / 交互问题 | Mavis | 客户端版本立项 |
| 真实 LLM 端到端评测 | PoC 不接生产模型 | Agent 行为真实表现未验证 | Mavis | 接入真实模型时启用 `agent-evaluation/*` |
| UI 自动化 | 仅 Chrome 演示 | 回归频繁时手工成本高 | Mavis | 进入长期版本或回归频繁时评估 |
| `recommendProducts` 多语言 (i18n) | 路线名 / 货类名 / 能力名都是中文硬编码 | 国际客户使用受限 | Mavis | 多语种支持立项 |
| `recommendProducts` 大规模性能（>10k products） | 单次调用 1 个 SQL + N 次 JSON.parse | N=10000 时未实测 | Mavis | 客户数 > 1000 时 |
| `opportunity-stages` 文案国际化 | 当前 `as const` 元组是中文 | 国际化后会改顺序 | Mavis | 国际化时同步重排 `state.ts` / `advance-time.post` 的 stage 数值 |
| 9 阶段常量扩展到 10+ | 当前长度 9 与 7 步推进流程强耦合 | 长度变化会断 `state.ts` 计数 | Mavis | 业务增加新阶段时同步扩展 `state.ts` / `advance-time.post` 行为 |

---

## 5. 用例与追踪矩阵

### 5.1 覆盖矩阵（需求 → 风险 → 指标 → 用例）

| 需求 / 变更 | 影响对象 | 风险 | 测试类型 | 场景 / 用例 ID | case_priority | 自动化 | 状态 |
| --- | --- | --- | --- | --- | ---: | --- | --- |
| 9 阶段常量合同 | `advance-time` / `state.ts` / `demo-action` | 改顺序 → 3 模块静默走错 | 合同 | `OPSTAGE-001` … `OPSTAGE-006` | CP0 | ✓ | ✅ pass |
| 有效联系人纯函数 | Agent / demo / 前端 | 改规则 → 难定位 | 合同 | `IVOC-001` … `IVOC-030` | CP0 | ✓ | ✅ pass |
| 推荐引擎空表 | 官网 `/api/website/quote` | 空表 → 500 / 异常 | 边界 | `WEB-REC-006` | CP0 | ✓ | ✅ pass |
| 推荐引擎无 published | 同上 | 全表过滤 → `[]` 是合理预期 | 边界 | `WEB-REC-007` | CP0 | ✓ | ✅ pass |
| 推荐引擎全 bonus 叠加 | 同上 | 封顶 98 是合同 | 边界 | `WEB-REC-008` | CP0 | ✓ | ✅ pass |
| 推荐引擎无 cityCountryMap 命中 | 同上 | 退化行为未定义 | 边界 | `WEB-REC-009` | CP0 | ✓ | ✅ pass |
| 推荐引擎并列稳定 | 同上 | Array.sort 稳定特性 | 边界 | `WEB-REC-010` | CP0 | ✓ | ✅ pass |
| 推荐引擎 500kg / 3cbm 边界 | 同上 | off-by-one 防御 | 边界 | `WEB-REC-011` | CP0 | ✓ | ✅ pass |

### 5.2 用例统计

| 维度 | 基线 (`e3c006a`) | 本次 | 累计 |
| --- | ---: | ---: | ---: |
| Unit 文件数 | 16 | +2 | **18** |
| Integration 文件数 | 5 | 0 | 5 |
| Smoke 文件数 | 1 | 0 | 1 |
| Agent-evaluation 文件数 | 1 | 0 | 1 |
| **测试文件总数** | **23** | **+2** | **25** |
| 用例总数 | 342 | **+32** | **374** |
| 全量耗时 | 42.6s | — | **29.7s**（缓存命中后） |

> 5 个 helper 文件不在统计内（`tests/helpers/` × 3 + `tests/agent-evaluation/` × 1 JSON + `tests/smoke/` × 1）

### 5.3 用例库 / 版本

- 用例库：`tests/unit/*.test.ts`
- 版本来源：git commit hash（`7c2bf8b`）
- 历史保留：旧版本 342 用例通过 git 历史回溯可达（`e3c006a`、 `4e6d98f`、 `2613266`、 `a1d4d6d`、 `c974c5a`）
- 单一事实源：每个测试文件描述头注释追溯需求/风险/责任范围

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
| 2 | 是否扩展 `opportunity-stages` 国际化 | 待国际化立项 | 暂不启动 |
| 3 | 是否补 `recommendProducts` 多产品全量封顶 98 的 property-based test | Mavis | 待 vitest fast-check 引入评估 |

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
# 1) 单测新文件验证
node node_modules/vitest/vitest.mjs run tests/unit/opportunity-stages.test.ts --reporter=verbose
# → 6 passed (0.3s)

node node_modules/vitest/vitest.mjs run tests/unit/is-valid-outreach-contact.test.ts --reporter=verbose
# → 20 passed (0.7s)

node node_modules/vitest/vitest.mjs run tests/unit/website-recommendations.test.ts --reporter=verbose
# → 11 passed (1.8s)

# 2) 全量回归
node node_modules/vitest/vitest.mjs run --reporter=dot
# → 26 files / 374 tests / 32.65s / 0 failures

# 3) Agent 评测护栏
node scripts/agent-eval-report.mjs --check
# → exit 0（5 mode × 20 用例 / 9 阈值 / ID 唯一 / 100% pass）
```

---

**维护**：Mavis · **审核**：研发 / 测试（PR review） · **下次复盘**：下一次 PR review 触发
