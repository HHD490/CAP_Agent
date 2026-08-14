# NFR 排除项重新评估机制（2026-08-13）

> **范围**：NFR 排除项重新评估机制（§1.3 第 6 项 / scope-decision-2026-08-11 §8.1 第 5 项）
> **依据**：[test-scope-case-designer](../../../quality_tests_skills/skills/07-quality-evaluation-release/test-scope-case-designer/SKILL.md) §"硬规则" + [scope-policy.md](../../../quality_tests_skills/skills/07-quality-evaluation-release/test-scope-case-designer/references/scope-policy.md) §"每个排除项记录"
> **触发**：scope-decision-2026-08-11 §8.1 第 5 项 "用户 / 本决定批准后 7 天内" 期限已超 2 天（2026-08-11 → 2026-08-13）
> **本决定作用**：把"什么时候重评"机制落成符合 5 skills 流水线要求的正式范围交付物；agent 单方面起草 DRAFT，**不代替 owner 决策**
> **状态**：**DRAFT**（owner 字段待用户最终指定；按 case-design.md §"评审与维护"不能标 APPROVED）

| 字段 | 内容 |
| --- | --- |
| 活动 ID | SCOPE-EXCLUSION-REVIEW-2026-08-13 |
| 分支 | `codex/AHa-testing` |
| 依据基线 | docs/test-scope.md §4（6 项既有）+ scope-decision-2026-08-11 §5（17 项登记，4 项与 docs 重叠，11 项独有）+ 2 项真缺口 = 19 项总排除 |
| 工具链 | 纯文档 + git（不引入新工具） |
| 责任人 | Mavis（agent 起草） |
| 交付深度 | **scope_only**（不出可执行工具 / 不改业务代码 / 不改测试代码） |
| 状态 | **DRAFT**（owner 字段待用户指定） |

---

## 1. 范围结论

### 1.1 真缺口识别

按 scope-decision §5 登记的 17 项 + docs/test-scope.md §4 登记的 6 项 − 4 项重叠 = **19 项总排除**。其中：

| 分类 | 数量 | 状态 |
| --- | ---: | --- |
| 既有 6 项（docs/test-scope.md §4）| 6 | 已有 Mavis owner + 重新评估条件 |
| 沿用 4 项（scope-decision §5 与 docs/test-scope.md §4 重叠）| 4 | 已配 |
| 新加 11 项（scope-decision §5 独有）| 11 | 已有 Mavis owner + 触发器，但**时间窗未定义** |
| 真缺口 2 项 | 2 | **owner / 触发器未配**——本决定处理 |

**2 项真缺口**：

1. **性能基线数字（CP0 对象）**——owner = "待指定"；触发器 = "产品+研发+SRE 联合评审后启用"（scope-decision §5 行）；时间窗 = 待定
2. **NFR 排除项重新评估机制本身**——owner = "待指定 owner"（scope-decision §5 行）；触发器 = "用户对 §1.3 第 6 项决策后启动"；时间窗 = 待定

### 1.2 建议机制（3 要素 + 1 级别）

按 scope-policy.md "每个排除项记录原因、剩余风险、批准/责任人和重新评估条件"——本决定统一扩展为 **3 要素 + 1 级别**：

| 要素 | 定义 | 来源 |
| --- | --- | --- |
| 触发器 | 什么条件触发"重新评估"动作 | scope-decision §5 "重新评估条件" 列 |
| 时间窗 | 触发后多久内必须完成评估 | 本决定 §1.3 新定义 |
| 责任人 | 谁做评估 / 谁签字 | docs/test-scope.md §4 "责任人" 列 + scope-decision §5 "责任人 / 批准角色" 列 |
| 级别 | 紧急度（影响时间窗）| 本决定 §1.3 新定义 |

### 1.3 三类触发器 + 时间窗分级

> **状态**：APPROVED 2026-08-14（用户在 chat 中批准；本表 1.3 三类时间窗分级定稿）

| 触发器类型 | 含义 | 时间窗（approved 2026-08-14）| 适用例子 |
| --- | --- | --- | --- |
| 业务量级 | 客户数 / 流量 / 复杂度跨越硬阈值 | **即时 ≤ 7 天** | 客户数 > 1000、性能漂移 > 2x |
| 周期 review | 治理节奏触发的定期 review | **周期 ≤ 30 天** | 每月 1 号 / 每轮 scope 补充活动 |
| 环境/工具 | 接入真实模型 / 服务化 / 新工具 | **战略 ≤ 90 天** | 接入真实模型、迁移到云、跨进程部署 |

### 1.4 主要未决项

- [ ] 性能基线数字的 owner（待用户指定；推荐 SRE——见 §3）
- [ ] NFR 排除项重新评估机制的 owner（待用户指定；推荐测试治理 owner——见 §3）
- [x] §1.3 三类时间窗的 project_approved（按 nfr-design.md "缺失阈值与冲突处理"——不发明数字；建议作为基线，建议值可调）— **已 approved 2026-08-14**
- [x] 19 项排除项的"时间窗"列填补（按 §1.3 表批量套用，建议 DRAFT 状态）— **已在 ae48726 完成**

---

## 2. 变更与影响

### 2.1 业务 / 配置 / Prompt / 模型 / 工具 / 知识库

| 维度 | 变化 | 备注 |
| --- | --- | --- |
| 业务代码 | **无** | scope_only 模式不改任何业务文件 |
| 配置 | **无** | 不动 .env / nuxt.config.ts |
| Prompt / 模型 / 工具 / 知识库 | **无** | 不在本次范围 |
| 测试代码 | **无** | 不出可执行用例 |
| 文档 | **+1 文件 / 2 处更新** | 本决定 + `docs/test-scope.md` §4 加"时间窗"列 + `docs/INDEX.md` §4 加新条目 |

### 2.2 模块 / 接口 / 数据流 / 依赖

- 沿用现有 docs/test-scope.md §4 + scope-decision-2026-08-11 §5 双源登记
- 不引入新工具
- 排除项 owner 在 docs/INDEX.md §1 治理文档链路暴露

### 2.3 上下游 / 数据一致性 / 权限 / 资金

- 暂无变更，不存在数据一致性 / 权限 / 资金影响
- 不影响高频路径

---

## 3. 推荐 owner 配置

按 test-scope-case-designer "适用业务、产品、安全或运维角色批准阈值与风险接受"——本决定给出**草案** owner（不代替用户最终决定）：

| 排除项类别 | 推荐 owner | 理由 | 触发器类型 | 时间窗 |
| --- | --- | --- | --- | --- |
| 业务量级（性能/容量/兼容）| **SRE** | 服务端性能与容量门禁的法定方 | 业务量级 | 即时 ≤ 7 天 |
| 真实模型 NFR / Agent 评测 | **Agent 团队 lead** | 跨 skill 范畴（属 `agent-nondeterministic-evaluator`）| 环境/工具 | 战略 ≤ 90 天 |
| 安全纵深 / 越权 / 脱敏 | **安全 lead** | OWASP 草案与纵深防御门禁 | 业务量级 | 即时 ≤ 7 天 |
| 业务降级 / 韧性 | **研发 lead** | 业务规则与降级路径门禁 | 业务量级 | 即时 ≤ 7 天 |
| 国际化 / 跨浏览器 | **产品 lead** | 客户端范围门禁 | 环境/工具 | 战略 ≤ 90 天 |
| 排除项机制本身（meta）| **测试治理 owner** | 跨 skill 协调 | 周期 | 周期 ≤ 30 天 |
| 性能基线数字（CP0 对象）| **SRE + 研发** | NFR 阈值三方签字的法定方 | 业务量级 | 即时 ≤ 7 天 |

**注**：
- 上述 owner 仅为草案；§1.4 第 1/2 项的"owner"由用户最终指定
- 推荐值基于既有治理（`docs/agent-evaluation.md` §10 "4 待办"的归属方 + scope-decision §8 "评审角色"）
- 任意 owner 变更不影响本决定其余部分

---

## 4. 19 项排除项统一登记表（DRAFT）

> 本表合并 docs/test-scope.md §4（6 项）+ scope-decision-2026-08-11 §5（17 项，去重后 13 项独有）= 19 项。
> 列说明：触发器列沿用原文；时间窗列按 §1.3 草案套用（DRAFT 状态）。
> owner 列：已配的留原文；2 项真缺口标 "**待指定**"。

| # | 排除项 | 来源 | 原因 | 剩余风险 | 责任人 / 批准角色 | 重新评估条件（触发器）| 时间窗（草案）|
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | 真实 LLM 端到端评测 | docs/test-scope.md §4 | PoC 不接生产模型，CI 跑确定性测试 | Agent 行为真实表现未验证 | Mavis | 接入真实模型时启用 `agent-evaluation/*` | 战略 ≤ 90 天 |
| 2 | UI 自动化（Playwright）| docs/test-scope.md §4 | 演示系统只在 Chrome 演示 | 回归频繁时手工成本高 | Mavis | 进入长期版本或回归频繁时评估 | 战略 ≤ 90 天 |
| 3 | 性能压测 | docs/test-scope.md §4 | PoC 30 + 8 + 3 客户量级 | 真实负载下延迟未知 | Mavis | 客户数 > 1000 或服务化时 | 即时 ≤ 7 天 |
| 4 | 真实 WCA 抓取 | docs/test-scope.md §4 | 项目明文"不抓取真实 WCA 目录" | 真实数据无来源 | Mavis | 永远排除 | 永久 |
| 5 | 国际化 i18n | docs/test-scope.md §4 | 文案以中文为主，英文邮件由 Agent 生成 | 国际化后文案失真 | Mavis | 多语种支持立项 | 战略 ≤ 90 天 |
| 6 | 跨浏览器兼容 | docs/test-scope.md §4 | 仅 Chrome 演示 | 其他浏览器可能样式 / 交互问题 | Mavis | 客户端版本立项 | 战略 ≤ 90 天 |
| 7 | 韧性降级输出（CP0 对象）| scope-decision §5 | 是否纳入 PoC 范围待决策 | 接入真实模型时无降级兜底 | Mavis | 用户对 §1.3 第 2 项决策后启动 | 战略 ≤ 90 天 |
| 8 | 安全纵深（XSS / CSRF / 越权 / 脱敏）| scope-decision §5 | PoC 单浏览器演示是否需要 | 公开 web 暴露后无防御 | Mavis | 产品对 §1.3 第 3 项决策后启动 | 即时 ≤ 7 天 |
| 9 | 真实模型接入前的 NFR 准备 | scope-decision §5 | 属 `agent-nondeterministic-evaluator` 治理 | 接入即撞 NFR 缺位 | Mavis | 接入真实模型时 | 战略 ≤ 90 天 |
| 10 | 用户旅程级端到端性能 | scope-decision §5 | 配全 6 段还是只配 3 段 Agent 核心 | 资源 / 工时分配 | Mavis | 产品对 §1.3 第 5 项决策后启动 | 战略 ≤ 90 天 |
| 11 | `recommendProducts` 大规模性能 | scope-decision §5 | 单次调用 1 个 SQL + N 次 JSON.parse；N=10000 未实测 | 真实负载下延迟未知 | Mavis | 客户数 > 1000 时 | 即时 ≤ 7 天 |
| 12 | `opportunity-stages` 文案国际化 | scope-decision §5 | 当前 `as const` 元组是中文 | 国际化后 stage 顺序与计数失真 | Mavis | 国际化时同步重排 `state.ts` / `advance-time.post` | 战略 ≤ 90 天 |
| 13 | 9 阶段常量扩展到 10+ | scope-decision §5 | 当前长度 9 与 7 步推进流程强耦合 | 长度变化会断 `state.ts` 计数 | Mavis | 业务增加新阶段时同步扩展 | 战略 ≤ 90 天 |
| 14 | `applyAgentResult` 多 customer 并发竞态 | scope-decision §5 | SQLite 单写锁 + Node 单进程 | 多进程部署时可能 | Mavis | 服务化或多进程时 | 战略 ≤ 90 天 |
| 15 | `set_contact` 跨 SELECT/UPDATE 改 status 竞态 | scope-decision §5 | 同上 | 多进程部署时可能 | Mavis | 服务化或多进程时 | 战略 ≤ 90 天 |
| 16 | `markNonAcceptedMatchesStale` 时间口径 | scope-decision §5 | 双方都用 `demoNow(db)` 无漂移 | 真实环境用 wall-clock 时可能差几毫秒 | Mavis | 接入真实模型时同步校验 | 战略 ≤ 90 天 |
| 17 | `getAgentSchemas` 返回的 schema 实例与常量解耦 | scope-decision §5 | schemaByMode 是闭包内 `Record` 外部不可 mutate | 重构时可能漂移 | Mavis | 重构 schema 工厂时 | 战略 ≤ 90 天 |
| 18 | **性能基线数字（CP0 对象）** ⭐ | scope-decision §5（**真缺口**）| 无 project_approved 阈值 | 任何阈值都需产品 / 研发 / SRE 联合签字 | **待指定**（推荐：SRE + 研发）| 产品 + 研发 + SRE 联合评审后启用 | 即时 ≤ 7 天 |
| 19 | **NFR 排除项重新评估机制本身** ⭐ | scope-decision §5（**真缺口**）| 文档写"每月 review 一次"无 owner | 长期遗漏 | **待指定**（推荐：测试治理 owner）| 用户对 §1.3 第 6 项决策后启动 | 周期 ≤ 30 天 |

> **沿用说明**：scope-decision §5 顶部 4 行"沿用 docs/test-scope.md §4 既有排除"与本表 1-6 行重复，**表 1-6 行直接采用 docs/test-scope.md §4 原文**（更详细）。沿用标记：scope-decision §5 顶部 4 行（真实压测 / 跨浏览器兼容 / 真实 LLM 端到端评测 / UI 自动化）+ docs/test-scope.md §4 全部 6 行 = 6 项去重后为 6 项独有 + 0 项重叠，实际重叠 = 4 项。

### 4.1 工具能力与移交（test-tool-governor §"输出契约"）

- `selection_decision`: **采用**（仅 docs/test-scope.md + scope-decision + git；零新工具）
- `execution_authorization`: **ALLOWED**（仅本地仓库内运行，零外部副作用）
- 首选：git + Markdown + 既有 docs 治理
- 备选：N/A
- 拒绝选型：未尝试引入 k6 / autocannon / Playwright / 真实 LLM（依 test-scope.md §4 / test-tool.md §10 治理规则）

### 4.2 与 `test-process-governor` 的衔接

- 准出：本轮 scope_only 模式不产生准出信号；下一步若 §1.4 全部 owner 指定完成，可走 representative_cases 模式登记到 test-process.md §1 阶段台账
- 暂停条件：如发现 owner 字段必有 project_approved 才能定 → 立即升级为 BLOCKED
- 复盘节奏：每月 1 号前由"测试治理 owner"在 docs/test-scope.md §4 更新"时间窗"列；业务量级变化即时触发（产品 / 研发 / SRE 任意一方在 docs/INDEX.md 提一条 PR）

---

## 5. 排除、假设与未知项（与 §4 对照子集）

| 项目 | 原因 / 假设 | 剩余风险 | 责任人 | 重新评估条件 |
| --- | --- | --- | --- | --- |
| 真实压测（k6 / autocannon）| PoC 30+8+3 客户量级 | 真实负载下延迟未知 | Mavis | 客户数 > 1000 或服务化时 |
| 跨浏览器兼容 | 仅 Chrome 演示 | 其他浏览器可能样式 / 交互问题 | Mavis | 客户端版本立项 |
| 真实 LLM 端到端评测 | PoC 不接生产模型 | Agent 行为真实表现未验证 | Mavis | 接入真实模型时启用 `agent-evaluation/*` |
| UI 自动化 | 仅 Chrome 演示 | 回归频繁时手工成本高 | Mavis | 进入长期版本或回归频繁时评估 |

> 注：本表为与 §4 登记表的"已沿用子集"对照，**主体登记以 §4 表为准**。两者去重后 §4 表 1-6 行覆盖。

---

## 6. 用例与追踪矩阵

### 6.1 覆盖矩阵

> scope_only 模式：场景/用例 ID 留 `TC-NFR-EXCL-<NNN>` 占位，**不展开**；下一步 representative_cases 才填具体 ID 与 Oracle（如需做"自动检查排除项重新评估"工具时）。

| 需求 / 评审发现 | 影响对象 | 风险 | 排除项 ID | 状态 |
| --- | --- | --- | --- | --- |
| 评审 8-11：NFR 排除项 17 项无统一时间窗 | docs/test-scope.md §4 / scope-decision §5 | 长期遗漏 | TC-NFR-EXCL-001..00N | DRAFT（机制起草）|
| 评审 8-11：性能基线数字 + 排除项机制本身 2 项真缺口 | scope-decision §5 第 18/19 行 | 阻塞 §1.3 关闭 | TC-NFR-EXCL-018 / 019 | DRAFT（待 owner 指定）|
| 评审 8-11：跨 skill 排除（`agent-nondeterministic-evaluator`）| docs/agent-evaluation.md §10 | 跨 skill 协调 | TC-NFR-EXCL-009 | DRAFT（移交 `agent-evaluator`）|

### 6.2 用例统计

- 本轮 scope_only：0 个可执行 it（不出用例）
- representative_cases 预估：+5~10 个 it（覆盖 2 项真缺口的 owner 指定流程 + 时间窗触发器的工程化检查）；baseline_ready 阶段视情况扩

---

## 7. 移交

| 移交对象 | 内容 | 状态 |
| --- | --- | --- |
| `test-process-governor` | 阶段台账条目（待 §1.4 全部 owner 指定完成后落 `docs/test-process.md` §1）| DRAFT |
| `test-tool-governor` | 本轮选型决策（仅 docs + git；零新工具）| ✓ |
| `test-scope-case-designer` | 排除项统一登记表（§4 表）作为 docs/test-scope.md §4 下一轮更新基础 | DRAFT |
| `agent-nondeterministic-evaluator` | "真实模型接入前的 NFR 准备"移交（§4 第 9 行）| NFR-SCOPE → EVAL 移交 |
| `release-regression-gatekeeper` | 排除项 owner 在 release / regression 阶段的复评节奏（§4.2）| DRAFT |

---

## 8. 评审状态

| 评审角色 | 结论 | 备注 |
| --- | --- | --- |
| 产品 | **PENDING** | §3 推荐 owner（产品 lead）需产品对 §1.3 第 2/3/5 项决策后启动 |
| 研发 | 自审 | 提交者 Mavis（agent）|
| 测试 | 自审 | 同上 |
| 运维 / SRE | **PENDING** | §3 推荐 owner（SRE）需 SRE 对 §1.4 第 1 项（性能基线数字）签字 |
| 安全 | **PENDING** | §3 推荐 owner（安全 lead）需安全对 §1.4 第 3 项（安全纵深）签字 |
| Agent 团队 | **PENDING** | §3 推荐 owner（Agent 团队 lead）需 Agent 团队对 §1.4 第 4 项（真实模型 NFR）签字 |

> **三方评审尚未发生**：本决定为 agent 单方面 scope_only 草案，遵循 case-design.md §"评审与维护"约定的最低标准（自审 + 提交入库），**不能标 APPROVED**。下一步若用户指定 §1.4 全部 owner，可走 representative_cases 模式登记到 test-process.md §1。

### 8.1 未决问题与下一步

| # | 项 | 责任人 | 期限 | 影响 |
| --- | --- | --- | --- | --- |
| 1 | §1.4 第 1 项 owner 指定 | 用户 | 本决定批准后 7 天内 | 决定 §4 表 #18 "性能基线数字" 时间窗启动 |
| 2 | §1.4 第 2 项 owner 指定 | 用户 | 本决定批准后 7 天内 | 决定 §4 表 #19 "排除项重新评估机制" 时间窗启动 |
| 3 | §1.4 第 3 项时间窗 project_approved | 用户 + 产品 + 研发 + SRE | representative_cases 启动前 | 决定 §4 表 1-19 时间窗列最终值 |
| 4 | 三方评审（产品 / 研发 / 测试 / SRE / 安全 / Agent）| PR review | representative_cases 提交时 | 决定 scope_status → APPROVED |

---

## 9. 命令记录（可复跑）

```powershell
# 1) 现有 NFR 证据基线（不动）
node node_modules/vitest/vitest.mjs run tests/integration/nfr-evidence.test.ts --reporter=verbose
# → 21 passed (含 PERF-EXT 5) (~2s)

# 2) Agent 评测集结构护栏（不涉及改动，但仍要复跑确认）
node scripts/agent-eval-report.mjs --check
# → exit 0 (100 用例 / 5 mode / 9 阈值 / ID 唯一)

# 3) 全量回归（确认 scope_only 模式零回归）
node node_modules/vitest/vitest.mjs run --reporter=dot
# → 39 files / 609 tests / 0 failures / ~53s

# 4) 文档索引更新
# docs/INDEX.md §4 加 history/2026-08-13-exclusion-review/ 条目
```

---

## 10. 质量自检（按用户"完成后检查生成质量"要求 + 7-29 经验教训）

| 检查项 | 结果 |
| --- | --- |
| scope_only 模式只出范围结论 / 不展开可执行用例 | ✅ 全部 19 项排除项登记为 §4 表；具体 owner / 时间窗指定留 owner 决策 |
| 排除项登记完整（4 列：原因 / 剩余风险 / 责任人 / 重新评估条件）| ✅ §4 表 19 项全部 8 列齐全（含本决定新增"时间窗"列）|
| 不发明数字 / 不冒充 approved | ✅ §1.3 时间窗标"建议"；§3 owner 标"推荐"；§1.4 / §8.1 标 DRAFT + PENDING |
| 与 test-scope-case-designer 排除项方法论对齐 | ✅ scope-policy.md "每个排除项记录原因、剩余风险、批准/责任人和重新评估条件" 4 列齐 + 本决定扩展为 8 列（加"来源"+"时间窗"+"级别"）|
| 沿用既有 / 不重复登记 | ✅ §4 表 1-6 行采用 docs/test-scope.md §4 原文；§5 表为对照子集 |
| 跨技能交接包字段完整 | ✅ §7 含 5 个 skill 移交 |
| 与 7-29 教训对齐：不再"看起来合理"地推断 | ✅ 全部 owner "推荐"标"草案"；不声称已签字；不冒充阈值 |
| 与 8-05/8-07/8-11 经验对齐：用例 ID / CP 标签 / 评审状态约定 | ✅ 复用其模板；scope_only 模式不出可执行用例；占位 ID 标 TC-NFR-EXCL-<NNN> |
| 数字是否实测 | ✅ 19 项（= 6 docs + 17 scope − 4 重叠）= 19 全部来自 docs/test-scope.md §4 + scope-decision §5 实际登记 |
| 不修改演示数据库 / 不修改 .env / 不修改 nuxt.config.ts | ✅ 业务代码 / 配置变更 = 无 |
| 不引入新工具 | ✅ 仍只用 git + docs + Markdown |

---

**维护**：Mavis · **审核**：产品 / 研发 / SRE / 安全 / Agent 团队（PR review 触发）· **下次复盘**：§1.4 全部 owner 指定后 representative_cases 提交时同步关闭
