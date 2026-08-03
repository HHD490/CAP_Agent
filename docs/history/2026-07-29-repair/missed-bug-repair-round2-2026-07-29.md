# CAP Agent 审核反馈修复汇报（2026-07-29 第二轮）

| 字段 | 内容 |
|---|---|
| 分支 | `codex/AHa-testing` |
| 针对 | 审核结论 **Request changes** |
| 参考 skills | `D:\quality_tests_skills\skills`（流程/门禁证据要求） |
| 提交状态 | **未提交、未推送** |
| Node | `v24.18.0` |

## 1. 结论

本轮按审核优先顺序完成修复，门禁复跑通过（含 **连续两次** `test:smoke`）。

| 项目 | 结论 |
|---|---|
| M-03 smoke 进程/锁清理 | **pass**（连续 2 次 smoke + 随后 build） |
| demo/action accepted stale | **pass**（`DEMO-STALE-001/002`） |
| 联系人有效性统一 | **pass**（共享 `isValidOutreachContact`） |
| M-01 边界补测 | **pass**（`LEGACY-PUBLISH-005/006` + 演示库副本验证） |
| M-04 handoff | 保持方案 A，未回退 |

## 2. 修复内容

### 2.1 Windows smoke 清理（优先）

`tests/helpers/nitro-smoke.ts`：

- `taskkill /T /F` 杀进程树
- `killListenersOnPort`（netstat 扫 LISTENING PID）
- `releaseNuxtLock` 删除 `.nuxt/nuxt.lock`
- `cleanupSmokeRuntime` 统一 finally 清理
- 断言端口关闭且无 nuxt.lock

证据：

```text
npm.cmd run test:smoke  → SMOKE1=0（2 passed, ~41s）
npm.cmd run test:smoke  → SMOKE2=0（2 passed, ~40s）
npm.cmd run build       → BUILD=0（紧随其后，无锁阻塞）
```

### 2.2 demo/action accepted stale

`update_customer` / `update_product` 的 stale SQL 增加 `AND status <> 'accepted'`。

测试：`tests/integration/demo-action-stale.test.ts`

### 2.3 联系人有效性统一

新增 `server/utils/contact.ts` → `isValidOutreachContact`：

```text
status === 'contactable' && email.trim() 非空
```

用于：

- `server/utils/agent.ts`（outreach）
- `server/api/demo/action.post.ts`（`accept_match` / `set_contact`）

空白邮箱：`CONTACT-VALID-001/002/003` 覆盖 helper、set_contact 400、accept_match 不启动建联。

### 2.4 M-01 边界

- `LEGACY-PUBLISH-005`：无 BY004 行时迁移不抛错并写标记
- `LEGACY-PUBLISH-006`：已正确 published=0 时不改 version/快照其它字段
- 额外：复制 `data/acquisition-demo.sqlite` 到临时文件跑 `prepareOpenedDatabase`（不写回演示库）

## 3. 门禁

| 命令 | 结果 |
|---|---|
| `npm.cmd test` | **44 passed / 10 files** |
| `npm.cmd run test:smoke` ×2 | **均 2 passed** |
| `npm.cmd run typecheck` | **exit 0** |
| `npm.cmd run build` | **exit 0** |

## 4. 变更文件（本轮增量）

- `tests/helpers/nitro-smoke.ts`
- `tests/smoke/import-xlsx.smoke.test.ts`
- `server/utils/contact.ts`（新）
- `server/utils/agent.ts`
- `server/api/demo/action.post.ts`
- `tests/integration/demo-action-stale.test.ts`（新）
- `tests/unit/legacy-publish.test.ts`（+005/006）

## 5. 给审核模型

请重点复核：

1. 连续两次 smoke 后 build 是否仍可视为稳定（本机已复现通过）。
2. `update_customer/product` 排除 accepted 是否符合“人工接受不可自动撤销”。
3. `isValidOutreachContact` 是否覆盖所有建联入口（当前 Agent + demo action；官网 identity 仍按既有输入契约）。

建议结论：Approve / Approve with notes / Request changes。
