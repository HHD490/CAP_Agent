# CAP Agent 遗漏 Bug 修复汇报（2026-07-29）

| 字段 | 内容 |
|---|---|
| 分支 | `codex/AHa-testing` |
| 依据 | [missed-bug-fix-plan-2026-07-29.md](./missed-bug-fix-plan-2026-07-29.md) |
| 基线 | `65e213a` / 上一轮 working tree |
| 提交状态 | **未提交、未推送** |
| Node | `v24.18.0`（Windows） |

## 1. 修复结论

审核 `Request changes` 的四项遗漏均已按 TDD 完成：

| 编号 | 结果 | 说明 |
|---|---|---|
| M-01 | **pass** | 旧库幂等迁移 `by004_unpublish_v1` |
| M-02 | **pass** | outreach 要求 `status === 'contactable'` |
| M-03 | **pass** | `npm run test:smoke` + `vitest.smoke.config.ts` 可发现/可跑 |
| M-04 | **pass** | 采用方案 A：`product_code: string \| null` + `source` |

## 2. 逐项证据

### M-01 LEGACY-PUBLISH

**Red：** `LEGACY-PUBLISH-001` 在带 `demo_state` 的旧库上 `published` 仍为 1。
**Green：** `prepareOpenedDatabase` → `runDatabaseMigrations`；仅修正 BY004；`schema_migrations` 标记幂等。
**命令：** `npx vitest run tests/unit/legacy-publish.test.ts` → 4 pass。

### M-02 OUTREACH contactable

**Red：** 005/006/009（`verify`/`invalid` + 有邮箱仍 completed）。
**Green：** `contact && status==='contactable' && email.trim()`；失败抛 `missing_contact`。
**命令：** `npx vitest run tests/unit/outreach-contact.test.ts` → 9 pass（001–009）。

### M-03 Smoke 入口

**问题：** 默认 `vitest.config.ts` 的 `include` 排除 smoke，报告命令 `No test files found`。
**Green：**
- 新增 `vitest.smoke.config.ts`
- `package.json` → `"test:smoke": "vitest run --config vitest.smoke.config.ts"`
- Windows 启动改用 `node + nuxt.mjs` / `node .output/server/index.mjs`，避免 `.cmd`/`Program Files` 拆分
- 失败输出 stderr/stdout；结束后断言端口关闭并删除临时目录

**实际命令与结果：**

```text
npm.cmd run test:smoke
→ 2 passed (dev state+import; build product state+import)
Node v24.18.0
EXIT_SMOKE=0
```

`SMOKE-ENTRY-001`（`vitest list --config vitest.smoke.config.ts`）收集到 2 个测试。

### M-04 Handoff 方案 A（已决策）

契约：

```ts
{
  product_code: string | null
  product_name: string
  source: 'provider_object' | 'legacy_string'
}
```

- 对象输入 → `source: 'provider_object'`
- 非空字符串 → `product_code: null`, `source: 'legacy_string'`（禁止空字符串 code）
- 缺字段/空对象/空串 → 失败且不写事件

**命令：** `handoff-legacy` + `handoff-contract` → 8 pass。

## 3. 门禁

| 命令 | 结果 |
|---|---|
| `npm.cmd test` | **37 passed / 9 files** |
| `npm.cmd run test:smoke` | **2 passed** |
| `npm.cmd run typecheck` | **exit 0** |
| `npm.cmd run build` | **exit 0**（见本轮执行） |
| `git diff --check` | **exit 0**（仅 CRLF warning） |

## 4. 变更文件

### 生产

- `server/utils/db.ts` — `prepareOpenedDatabase` / `runDatabaseMigrations` / BY004 迁移
- `server/utils/agent.ts` — contactable 校验；handoff Option A

### 测试/配置

- `vitest.smoke.config.ts`（新）
- `package.json` — `test:smoke`
- `tests/unit/legacy-publish.test.ts`
- `tests/unit/outreach-contact.test.ts`（+005–009）
- `tests/unit/smoke-entry.test.ts`
- `tests/unit/handoff-legacy.test.ts`
- `tests/unit/handoff-contract.test.ts`（对齐 Option A）
- `tests/helpers/nitro-smoke.ts`
- `tests/smoke/import-xlsx.smoke.test.ts`

### 未直接改动

- `data/acquisition-demo.sqlite`（不直接改文件；启动时经迁移修复）
- `.env.example` / `nuxt.config.ts` / 用户报告 HTML

## 5. 汇总表

| 测试组 | Red 证据 | Green/回归 | 结果 | 未决风险 |
|---|---|---|---|---|
| LEGACY-PUBLISH | 旧库 BY004 仍 published=1 | unit + npm test | pass | 真实演示库需一次应用启动以落迁移标记 |
| OUTREACH-CONTACT 005–009 | verify/invalid 仍 completed | unit | pass | none |
| SMOKE-ENTRY | 默认配置不可发现 | `npm run test:smoke` | pass | 长耗时；勿与并行 nuxt 抢端口 |
| HANDOFF-LEGACY | 空 code / 无 source | unit | pass | UI 若假设 code 恒为 string 需跟进 |

## 6. 给审核模型

请复核：

1. 迁移是否过宽（是否误伤非 BY004）。
2. contactable 规则是否与 `demo/action.post` / UI 一致。
3. `npm run test:smoke` 是否足以替代“报告命令可复现”。
4. Option A 的 `null` code 是否可接受（相对空字符串）。

建议结论选项：Approve / Approve with notes / Request changes。
