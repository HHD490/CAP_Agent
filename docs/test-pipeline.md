# 测试流水线与质量门禁

本项目的测试架构与 5 个 skill 严格对齐（详见 `D:/quality_tests_skills/skills/`）。本文档描述**如何在本地与 CI 跑测试**、**门禁的硬指标**、**出问题时该看哪里**。

## 1. 一图概览

```
┌────────────────────┐
│   npm test         │  ← vitest run
│   - 33 个 test 文件 │
│   - 556 条用例     │  ← 单测 + 集成测（不含 smoke）
└────────┬───────────┘
         │
         ├──→ 输出 coverage/coverage-final.json  （test:coverage）
         │
┌────────▼───────────┐
│ test:agent-eval    │  ← scripts/agent-eval-report.mjs --check
│   - 校验 JSON 结构 │
│   - 校验 9 项阈值  │
│   - 校验用例数     │
└────────┬───────────┘
         │
         ├──→ 输出 docs/agent-evaluation/<date>.md （非 --check）
         │
┌────────▼───────────┐
│ test:quality       │  ← typecheck + test + test:agent-eval 串行
│   （推荐用这个）    │     任何一步失败 → exit 1
└────────┬───────────┘
         │
┌────────▼───────────┐
│ .github/workflows/ │  ← push / PR 触发
│ test-quality.yml   │     自动跑 typecheck + test + agent-eval
└────────────────────┘
```

## 2. 本地命令速查

| 命令 | 作用 | 何时用 |
| --- | --- | --- |
| `npm test` | 跑全部单测 + 集成测 | 日常开发 |
| `npm run test:watch` | 监听模式跑 vitest | 改代码时 |
| `npm run test:unit` | 只跑单测 | 改纯函数时 |
| `npm run test:integration` | 只跑集成测 | 改 handler 时 |
| `npm run test:coverage` | 跑 vitest + v8 coverage | 提 PR 前 / 评估覆盖 |
| `npm run test:agent-eval` | 结构/阈值/数量护栏（exit 1） | CI gate |
| `npm run test:agent-eval:report` | 同上但输出报告（不退出） | 看报告 |
| `npm run test:agent-eval:stats` | 仅输出 JSON 统计 | 调试 |
| `npm run test:quality` | typecheck + test + agent-eval | **发布前**必跑 |
| `npm run test:smoke` | 跑 Windows Nitro HTTP smoke | 手动（需启动 dev server） |

## 3. 硬指标（spec_default）

依据 5 个 skill 的规范默认值，**项目级更严时可覆盖**，但不能放宽。

### 3.1 单元 / 集成（test-process-governor）

- **核心用例 100% 通过**：CP0/CP1 必 100% 绿
- **缺陷 P0/P1 零遗留**：不通过即 FAIL
- **类型严格**：`npm run typecheck` 必过

### 3.2 覆盖率（test-scope-case-designer 建议）

> 注：覆盖率是 **项目级 SLO**，本仓库当前未硬要求，但建议关键路径 ≥80%。

| 模块 | 当前 | 目标 |
| --- | --- | --- |
| `server/utils/agent.ts` | 90.2% line / 86.6% branch | 95% / 100% |
| `server/api/demo/action.post.ts` | 98.0% line / 90.5% branch | 95% / 100% |
| `server/utils/state.ts` | 99.2% / 94.5% | 95% / 100% |
| `server/utils/website.ts` | 100% / 82.6% | 95% / 100% |
| `pages/` / `components/` | 0%（UI 层未覆盖） | （按项目决定） |

### 3.3 Agent 离线评测（agent-nondeterministic-evaluator）

| 维度 | 目标 | 最低 | source_layer |
| --- | ---: | ---: | --- |
| 实体抽取 | 98% | 95% | spec_default |
| 指令遵循 | 95% | 85% | project_required |
| 计算正确性 | 100% | 100% | spec_hard_gate |
| 推荐合理性 | 95% | 90% | spec_default |
| 输出格式 | 100% | 98% | spec_default |
| 鲁棒性 | 90% | 85% | spec_default |
| 一致性 | 95%（≤5% 差异） | 90% | spec_default |
| 幻觉 | 99% | 95% | spec_default |
| 安全拒绝 | 100% | 100% | spec_hard_gate |

**测试集结构硬约束**（`--check` 必检）：
- 5 个 mode 全部覆盖：customer_profiling / product_matching / outreach_drafting / reply_qualification / handoff_summary
- 每 mode ≥20 条用例（当前各 20）
- 每条用例必带 `source` / `labels`（含 mode + regression）/ `constraints` / `dataset_version` / `expected_*` 或 `forbidden_*` / `samples`
- 非确定性用例 `samples ≥ 3`（除非期望被 schema 拒绝，`samples=1` 也合法）
- 高风险用例每条独立判定（不允许被平均）

### 3.4 发布门禁（release-regression-gatekeeper）

| 阶段 | 门禁 |
| --- | --- |
| 准入 | dev 自测报告 + 提测材料 + 环境/账号/数据就绪 |
| 冒烟 | 启动 + 核心链路 + 关键 API 必 100% 通 |
| 系统测试 | `npm run test:quality` 必全绿 |
| NFR | 性能 / 可观测 / 安全 / 韧性 4 类证据齐（见 `tests/integration/nfr-evidence.test.ts`） |
| 准出 | P0/P1 零遗留 + Agent 9 项阈值达标 + 产品验收 + 报告归档 |
| 发布 | 全量 / 灰度 / Hotfix 按风险选；高风险必灰度 |

## 4. CI 触发与失败处理

`.github/workflows/test-quality.yml` 在以下情况自动跑：
- push 到 `main` 或 `codex/**`
- PR 目标 `main`

**任何一步失败 → PR 红 X → 不能合**。

| 失败 | 看哪里 | 谁负责 |
| --- | --- | --- |
| typecheck | `npm run typecheck` 输出 | 代码作者 |
| vitest 失败 | 对应 `.test.ts` 文件 + `vitest` 报错 stack | 代码作者 |
| test:agent-eval 失败 | stdout 中的"缺少 X" / "少于 X" | 测试 / Agent 维护者 |
| coverage 下降 | `coverage/index.html` | 测试维护者 |

## 5. 已知边界（PoC 范围）

- `pages/` / `components/` / `layouts/` 覆盖率 0%（纯 UI 层，PoC 无 E2E 框架）
- `tests/smoke/**` 需 `nuxt dev` 启动，CI 不跑（要 Windows Nitro HTTP 集成）
- Agent 真实 LLM 评测 baseline 未生成（`tests/agent-evaluation/baselines/` 目录占位空）—— 接入 OpenAI 后跑 `node scripts/agent-eval-runner.mjs`（待补）

## 6. 配套文档

- `D:/quality_tests_skills/skills/test-scope-case-designer/SKILL.md` — 范围与用例设计
- `D:/quality_tests_skills/skills/test-tool-governor/SKILL.md` — 工具选型与治理
- `D:/quality_tests_skills/skills/test-process-governor/SKILL.md` — 流程与准出
- `D:/quality_tests_skills/skills/agent-nondeterministic-evaluator/SKILL.md` — Agent 评测
- `D:/quality_tests_skills/skills/release-regression-gatekeeper/SKILL.md` — 发布门禁
- `docs/agent-evaluation.md` — Agent 评测体系摘要（项目内）
- `docs/test-scope.md` — 项目级测试范围（项目内）
- `docs/release-regression.md` — 项目级发布回归（项目内）
