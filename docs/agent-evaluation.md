# Agent 非确定性评测手册

> 基于 [agent-nondeterministic-evaluator](../README.md) skill 的标准模板。本文档定义
> CAP_Agent 项目 5 个 Agent 模式的离线评测集（core-regression.json）、9 个通过率阈值、
> 采样策略、基线管理、结构护栏和准出门禁。

## 1. 评测对象

5 个 Agent 模式（与 `docs/test-scope.md` §3 一致）：

| Mode | 任务 | 典型输入 | 风险维度 |
| --- | --- | --- | --- |
| `customer_profiling` | 公司客户画像 + `customer_type` 业务枚举 | 公司名、国家、城市、邮箱 | 枚举正确性、证据可追溯 |
| `product_matching` | 公司×产品匹配候选 + 风险/缺失/证据 | 客户档案 + 产品库 | 已发布过滤、推荐合理性 |
| `outreach_drafting` | 中英文建联邮件草稿 | 客户+联系人+机会 | 联系人有效性、stage 推进、原子性 |
| `reply_qualification` | 客户回复意图判断 | 多语种邮件原文 | intent 分类、对抗注入 |
| `handoff_summary` | 销售交接摘要 | 机会全量 + 产品快照 | `recommended_product` 契约、缺字段拒绝 |

## 2. 评测数据集

- **路径**：`tests/agent-evaluation/core-regression.json`
- **版本**：`v1.0`（顶层 `version` 字段）
- **总用例**：100 条（每 mode ≥ 20）
- **采样**：非确定性维度每条用例采样 **3-5 次**，记录通过率、关键字段差异和失败分布
- **元数据**（顶层 `metadata`）：

```json
{
  "agent_modes": ["customer_profiling", "product_matching", "outreach_drafting", "reply_qualification", "handoff_summary"],
  "total_cases": 100,
  "sampling_strategy": "非确定性维度每条用例采样 3-5 次，记录通过率、关键字段差异和失败分布",
  "baseline_storage": "tests/agent-evaluation/baselines/<version>.json",
  "reporter": "scripts/agent-eval-report.mjs"
}
```

### 2.1 用例字段（必填）

| 字段 | 用途 | 不允许缺失的原因 |
| --- | --- | --- |
| `id` | 全局唯一 ID（如 `PROFILE-001`） | 与 `expected_*` 一起做"规则而非主观评分"的判定 |
| `name` | 人类可读用例名 | 报告/复盘可读性 |
| `input` | 输入对象（必须是 object，非数组） | 评测执行需要稳定序列化 |
| `expected_fields` / `expected_rejection` / `forbidden_regex` / `forbidden_fields` / `must_contain_evidence` | **至少一种**可自动判定规则 | 不能依赖主观评审 |
| `samples` | 采样次数 | 非 rejection 用例必须 ≥ 3 |
| `max_diff_rate` | 高风险非 rejection 用例一致性约束 | 防"碰巧全过" |
| `risk` | `high` / `medium` / `low` | 决定是否进入核心回归集 |
| `source` | 来源字符串（人工构造 / 线上回流 / 文档引用） | 追溯用例来源 |
| `labels` | 必含 `<mode>` + `regression` | 标签一致性 |
| `constraints` | 至少 1 条自然语言约束 | 用例文档化 |
| `dataset_version` | 等于顶层 `version` | 防止"静默漂移" |

## 3. 通过率阈值

| 维度 | target | minimum | 说明 |
| ---: | ---: | ---: | --- |
| entity_extraction | 98% | 95% | 实体抽取准确率 |
| instruction_following | 95% | 85% | 指令遵循 / 约束满足 |
| computation | **100%** | **100%** | 计算正确性（**硬门禁**，不允许放宽） |
| recommendation | 95% | 90% | 推荐合理性 |
| format | 100% | 98% | 输出格式遵循 |
| robustness | 90% | 85% | 鲁棒性 |
| consistency | 95% | 90% | 一致性差异 |
| hallucination | 99% | 95% | 幻觉错误率 |
| safety | **100%** | **100%** | 安全拒绝（**硬门禁**，不允许放宽） |

> **硬门禁**：`computation` 与 `safety` 任何一次失败即当前门禁 `FAIL` 并人工复核，不允许靠"平均通过率"覆盖。

## 4. 模式覆盖与用例数量

| Mode | 用例数 | 最低线 | 备注 |
| --- | ---: | ---: | --- |
| customer_profiling | 20 | 20 | 6 枚举 + 边界 + 非法值 |
| product_matching | 20 | 20 | BY004 不允许 + 风险/缺失/证据 |
| outreach_drafting | 20 | 20 | 联系人有效性 + stage 推进 + 原子性 |
| reply_qualification | 20 | 20 | intent 分类 + 对抗注入 |
| handoff_summary | 20 | 20 | 对象/字符串双兼容 + 缺字段拒绝 |
| **合计** | **100** | **100** | `metadata.total_cases` 必须等于实际求和 |

## 5. 不可违反的规则（与 skill 对齐）

1. **先确定性、后非确定性**：`npm test`（374 条确定性用例）必须全绿，才允许进 Agent 离线评测。基础构建/服务/API/工具故障未通过时，不给 Agent 准出。
2. **预先声明采样**：`samples` 字段是发布前冻结值，评测执行时不得事后改变。
3. **高风险失败不被平均**：`risk: 'high'` + 非 rejection 用例在 `samples` 次有效运行中任一失败即当前门禁 `FAIL`。
4. **分开技术与语义失败**：网络/限流/服务异常与语义失败分域统计；重试不得掩盖不稳定性。
5. **同集比较基线**：候选与基线必须使用**同一版本**评测集、同一判定规则、可比配置；不可比时标 `REVIEW_REQUIRED`。
6. **规则优先于主观评分**：字段/Schema/计算/安全先用确定性规则；复杂语义再人工抽检，LLM 评审仅作辅助。
7. **阈值所有权清晰**：表 §3 的 target/minimum 是项目批准值；如需调整，必须更新本节 + `core-regression.json` + `scripts/agent-eval-report.mjs` + `tests/unit/agent-evaluation.test.ts` 四处，并说明业务依据。
8. **基线存储**：`tests/agent-evaluation/baselines/<version>.json`——仅在"接入真实模型后"启用；当前 v1.0 不写基线，避免把"未跑过的分数"误当基线。

## 6. 结构护栏（CI 必跑）

`tests/unit/agent-evaluation.test.ts` 在 `npm test` 中执行，14 个用例（`AGENT-EVAL-001` 至 `014`）覆盖：

| ID | 护栏 | 失败即 |
| --- | --- | --- |
| 001 | `core-regression.json` 存在且可解析 | `FAIL` |
| 002 | 5 mode 全部覆盖、每 mode ≥ 20 | `FAIL` |
| 003 | 9 阈值完整 + target ≥ minimum | `FAIL` |
| 004 | `computation` / `safety` 必须 100% | `FAIL` |
| 005 | 用例 ID 全局唯一 | `FAIL` |
| 006 | 高风险非 rejection 必须 samples ≥ 3 | `FAIL` |
| 007 | 高风险非 rejection 必须有 `max_diff_rate ≤ 0.1` | `FAIL` |
| 008 | reporter 脚本存在且支持 `--check` / `--stats` | `FAIL` |
| 009 | ≥ 50% 用例覆盖对抗/边界 | `FAIL` |
| 010 | 总用例数 ≥ 100 | `FAIL` |
| 011 | 每条用例有 source/labels/constraints/dataset_version | `FAIL` |
| 012 | 每条用例有 input + 可自动判定规则 + risk + samples | `FAIL` |
| 013 | `metadata` 与 cases 一致 + `baseline_storage` 指向 `baselines/` | `FAIL` |
| 014 | 评测数据中不出现中国手机号 / `sk-` token / 私钥 | `FAIL` |

**护栏作用**：保证"评测集是结构完整的、可自动判定的、基线可比的"，与"模型实际通过率"完全解耦——结构护栏失败时**不修改阈值或人为放宽**。

## 7. 评测 reporter

### 7.1 三种运行模式

```bash
node scripts/agent-eval-report.mjs                  # 输出 markdown 报告到 stdout
node scripts/agent-eval-report.mjs --check          # CI 护栏：errors > 0 时 exit 1
node scripts/agent-eval-report.mjs --stats          # 末尾追加 ---STATS--- + JSON
```

### 7.2 报告章节

- **总览**：总用例数、覆盖模式数、高风险用例数、低采样用例数
- **各模式覆盖**：count / high / low / 反例 / 一致性约束
- **通过率阈值**：来自 §3（与 `core-regression.json` 同源）
- **校验结果**：`✅` 或逐条错误 + 警告
- **后续动作**：CI 接入、基线归档、相对基线变化、人抽检

### 7.3 报告归档

```
docs/agent-evaluation/<YYYY-MM-DD>.md
```

由 `npm run test:agent-eval > docs/agent-evaluation/<date>.md` 生成；归档时与 git commit SHA 对应。

## 8. 评测集演进（版本管理）

| 触发 | 动作 | 注意事项 |
| --- | --- | --- |
| 新增 mode | 顶层 `version` +1；新增 mode 增加 ≥ 20 用例 | 同步更新 `docs/test-scope.md` §3 |
| Prompt / 模型 / 工具 / 知识库变更 | 现有 100 用例迁移到新版本；增量补充 | 旧版本评测集保留可读；不覆盖来源 |
| 线上失败回流 | 新增 1 条用例到对应 mode | 标 `source: '线上回流-<date>'` + `risk: 'high'` |
| 阈值调整 | 更新 §3 + `core-regression.json.thresholds` + reporter + 护栏测试 | 必须说明业务依据；硬门禁不允许降低 |

## 9. 与 `test-process-governor` 的衔接

- **准出位置**：本技能在 `npm run test:agent-eval` + 真实模型评测（启用后）通过后输出 `offline_gate` 状态；由 `docs/test-process.md` §3 判定整体准出。
- **`PASS_WITH_ACCEPTED_RISK`**：仅当 `computation` / `safety` 100% 通过、其余维度在 `minimum` 以上、且所有 `impact_on_agent_evaluation=NONE` 的已批准风险均已记录，方可携带条件进入 `release-regression-gatekeeper` 评审。
- **上游门禁失败时**：本技能不输出"相对基线通过"，只输出 `BLOCKED` 并列出缺失项。
- **`STOP_RECOMMENDED`**：本技能可以建议停止放量，不声称已经停止流量或完成回滚——决定权在 `release-regression-gatekeeper`。

## 10. 已知限制与待办

- **真实模型 CI 评测未启用**——v1.0 只能跑"结构护栏"，实际通过率需在接入真实模型后补"评测执行"框架。
- **基线未生成**——`tests/agent-evaluation/baselines/` 目录尚未创建，启用前必须完成至少一轮真实模型 dry-run 校对。
- **在线监控未接入**——`mode: online_monitor` 的指标（解析成功、用户修正、负面反馈、成功率、延迟）暂未对接灰度发布链路。
- **人工抽检比例**——`docs/test-process.md` §3 要求 ≥ 10% 复杂语义用例人工抽检，结果与自动指标分开记录，目前仅在报告中给出字段，待执行。

---

**维护**：Mavis · **审核**：产品 / 研发 · **下次复盘**：接入真实模型前
