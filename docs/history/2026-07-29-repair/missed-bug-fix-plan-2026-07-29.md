# CAP Agent 遗漏 Bug 修复规划（2026-07-29）

## 1. 文档定位

本文件基于 [repair-review-report-2026-07-29.md](./repair-review-report-2026-07-29.md) 的审核结果，规划上一轮修复遗漏的缺陷。本阶段只编写规划，不修改生产代码、测试代码、配置或演示数据库。

当前分支：`codex/AHa-testing`

问题核对基线：`65e213a64941131e7b2353dafb7ffb93fc762371`

上一轮验证现状：

- 默认 unit/integration：22 个测试通过。
- `typecheck`：通过。
- `build`：通过。
- Windows smoke 报告命令无法发现测试：`vitest.config.ts` 的 `include` 排除了 `tests/smoke`。
- 当前 `data/acquisition-demo.sqlite` 中 BY004 仍为 `published = 1`、PMS 快照 `published = true`。

审核结论为 `Request changes`。修复完成前不能以“新测试全部通过”作为整体完成依据。

## 2. 本轮遗漏问题清单

| 编号 | 遗漏问题 | 严重性 | 处理目标 |
|---|---|---:|---|
| M-01 | 已存在的演示数据库不会被 BY004 发布状态修复 | P1 | 增加幂等、窄范围的数据迁移/启动修复，并用旧库夹具验证 |
| M-02 | outreach 只检查邮箱非空，没有检查联系人 `status = 'contactable'` | P1 | 统一“有效联系人”规则，阻止 `verify` 等状态生成 draft/stage 5 |
| M-03 | Windows smoke 测试入口不可发现、不可按报告命令复现 | P1 | 建立独立 smoke 配置/命令，实际验证 dev 与 build 两种 Nitro 运行时 |
| M-04 | legacy 字符串 handoff 被规范化成空 `product_code` | P2/需决策 | 明确兼容契约，避免输出自相矛盾的结构化产品对象 |

## 3. 工作区与安全边界

开始实施前必须重新记录：

```powershell
git branch --show-current
git status --short --branch
```

不得覆盖或回滚以下已有工作区内容：

- `.env.example`
- `nuxt.config.ts`
- `server/utils/agent.ts`
- `server/utils/db.ts`
- `server/api/website/rematch.post.ts`
- `server/api/website/identity.post.ts`
- 未跟踪报告和上一轮测试文件

测试不得直接写入或重置：

- `data/acquisition-demo.sqlite`
- `data/promptfoo.sqlite`
- 其他真实演示数据库

旧数据库迁移测试必须复制到临时目录或使用临时 SQLite 文件。不得用 `resetDemoDatabase()` 代替迁移测试，因为 reset 会掩盖“已有 `demo_state` 的数据库不会重新 seed”的真实缺陷。

## 4. M-01：已有数据库的 BY004 发布状态迁移

### 4.1 现状与根因

当前 [server/utils/db.ts](../server/utils/db.ts) 的 `getDb()` 只有在 `demo_state` 不存在时才调用 seed/reset。已有数据库会直接沿用旧产品行，因此上一轮只修改 `seedProducts` 不能修复现存库。

审核时实际查询到：

```text
data/acquisition-demo.sqlite / products / BY004
quote_ready = 0
published = 1
pms_snapshot_json.published = true
```

### 4.2 TDD 测试规格

先新增以下测试，不修改生产代码：

- `LEGACY-PUBLISH-001`：创建一个带有 `demo_state` 的临时旧库，插入旧版 BY004（`published = 1`、快照 `published = true`），同时插入客户、机会、匹配、事件和一条非 BY004 产品记录。调用正式数据库初始化入口，断言 BY004 被修正为 `published = 0`，快照为 `false`，其他业务表记录不被删除或重置。
- `LEGACY-PUBLISH-002`：对同一个已迁移数据库再次初始化，断言结果不变，不重复增加版本/事件，不重复写迁移副作用。
- `LEGACY-PUBLISH-003`：验证非 BY004 产品的 `published`、`quote_ready`、`product_version`、营销字段和 PMS 快照保持不变。
- `LEGACY-PUBLISH-004`：新建空库/无 `demo_state` 的路径仍使用新 seed，BY004 初始即为 `published = 0`；该用例与现有 `PRODUCT-PUBLISH-001` 互补。

Red 阶段必须证明：仅修改 seed 时，`LEGACY-PUBLISH-001` 在旧库上仍失败。不能只在 fresh/reset 数据库上证明失败。

### 4.3 Green 实现边界

推荐采用显式、幂等的数据库迁移机制，满足：

1. 在 `getDb()` 返回可用数据库前执行，或在同一初始化阶段执行。
2. 只针对已知旧状态的 BY004 行修正 `published` 和 PMS snapshot 的 `published` 字段。
3. 不调用全量 `resetDemoDatabase()`，不删除客户、联系人、机会、匹配、事件或任务。
4. 有明确的迁移版本/完成标记，重复启动不会重复写入副作用。
5. 新库和已修复库都能安全通过，不影响正常产品匹配。

迁移标记的实现方式由开发决定，但必须测试“未迁移旧库、迁移后再次启动、无产品行、已是正确状态”四种情况。不得直接修改仓库中的 `data/acquisition-demo.sqlite` 作为修复手段。

### 4.4 验收

- 默认数据库启动后，BY004 不再进入 `published = 1` 的 Agent context。
- 旧数据库中的客户业务数据保留。
- 迁移可重复执行且没有重复事件或版本漂移。
- `PRODUCT-PUBLISH-*` 与 `LEGACY-PUBLISH-*` 全部通过。

## 5. M-02：联系人必须处于 `contactable`

### 5.1 现状与根因

当前 `outreach_drafting` 只判断联系人存在且 `email.trim()` 非空；虽然查询了 `status`，但没有使用。系统其他路径已经把有效联系人定义为：

```ts
contact && contact.status === 'contactable' && contact.email
```

因此 `verify`、`invalid` 等状态只要有邮箱，仍可能生成 draft、清空 blocker 并推进 stage 5。

### 5.2 TDD 测试规格

保留上一轮 `OUTREACH-CONTACT-001` 至 `004`，新增：

- `OUTREACH-CONTACT-005`：联系人存在、邮箱非空、`status = 'verify'`；Agent 任务必须失败，不得新增 draft，不得产生 `draft_ready`，stage/blocker 保持不变。
- `OUTREACH-CONTACT-006`：联系人存在、邮箱非空、`status = 'invalid'` 或其他非 `contactable` 状态；结果同上。
- `OUTREACH-CONTACT-007`：`status = 'contactable'` 但邮箱只有空白字符；结果同无效联系人。
- `OUTREACH-CONTACT-008`：`status = 'contactable'` 且邮箱为非空有效值；中文路径只新增一个非空 recipient draft，并按原契约推进到 stage 5。
- `OUTREACH-CONTACT-009`：英文路径使用相同有效联系人规则；不得因为英文不推进 stage 5 而绕过 recipient 校验。

每个失败测试都要断言：

- `email_drafts` 没有新增记录；
- 没有空 recipient；
- 没有 `draft_ready` 成功事件；
- 机会的 stage、blocker、历史 draft 不变；
- Agent task 有可定位的 `missing_contact` 错误。

### 5.3 Green 实现边界

抽取或复用“有效联系人”判断，至少同时满足：

```text
contact 存在
contact.status === 'contactable'
contact.email.trim() 非空
```

校验必须发生在 draft INSERT、机会更新和成功事件之前。成功路径继续使用事务；失败路径不得启动事务写入副作用。若要增加邮箱格式校验，必须同时补充产品规则和测试，不得只在 Agent 路径单方面引入与既有接口不一致的格式规则。

### 5.4 验收

- `verify + 有邮箱` 不再生成 draft 或 stage 5。
- 所有调用 Agent outreach 的入口都遵守同一有效联系人规则。
- UI 已禁用的非 `contactable` 联系人不能通过后端 Agent 路径绕过。
- `OUTREACH-CONTACT-001` 至 `009` 全部通过。

## 6. M-03：建立可复现的 Windows Nitro smoke 入口

### 6.1 现状与根因

当前 `vitest.config.ts` 的 `include` 只覆盖：

```text
tests/unit/**/*.test.ts
tests/integration/**/*.test.ts
```

所以报告中的：

```powershell
npx vitest run tests/smoke/import-xlsx.smoke.test.ts
```

实际返回 `No test files found`。默认 `npm test` 也不会执行 smoke。上一轮报告中标记为 pass 的 Windows 证据目前不可由报告命令独立复现。

### 6.2 TDD/测试基础设施规格

这项不需要修改 xlsx 生产代码，先修测试入口：

- `SMOKE-ENTRY-001`：专用 smoke 配置能够发现 `tests/smoke/import-xlsx.smoke.test.ts`，至少能收集到两个测试，不再返回 `No test files found`。
- `SMOKE-ENTRY-002`：Windows `nuxt dev` 启动后，`/api/state` 返回 HTTP 200 JSON，且 stderr/stdout 没有 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。
- `SMOKE-ENTRY-003`：dev server 上通过 multipart 上传 xlsx，HTTP 200 且 `created = 1`。
- `SMOKE-ENTRY-004`：构建产物启动后重复执行 state/import 检查。
- `SMOKE-ENTRY-005`：服务启动失败、端口超时或请求失败时测试必须失败，并输出进程 stdout/stderr；不能把等待超时误报为通过。
- `SMOKE-ENTRY-006`：测试结束后无残留 Nitro/Node 子进程、端口、临时数据库和临时目录。

### 6.3 推荐实现方式

保留 unit/integration 与长耗时 smoke 的分离，但增加明确入口之一：

```json
{
  "scripts": {
    "test:smoke": "vitest run --config vitest.smoke.config.ts"
  }
}
```

`vitest.smoke.config.ts` 应复用 Node 环境、setup shim、根目录和路径别名，但 `include` 必须包含 `tests/smoke/**/*.test.ts`。也可以使用 Vitest projects，但必须保证开发者可以执行一个明确的命令发现 smoke。

Windows 进程启动建议避免依赖 shell 对 `npx` 的隐式解析：使用本地 `nuxt.cmd`/Node 可执行入口，或根据平台显式选择 `.cmd` 后缀。启动器必须：

- 使用随机端口并确认实际监听；
- 等待 `/api/state` 成功，而不是仅等待进程存在；
- 失败时保留 stderr/stdout；
- 用进程树级别的清理终止服务；
- 最终检查端口和子进程已释放。

### 6.4 验收命令

```powershell
npm.cmd run test:smoke
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

报告必须记录实际命令、测试收集数量、HTTP 状态码、Node 版本、进程退出码和 stderr 摘要。不能只写“Windows smoke pass”。

## 7. M-04：明确 legacy `recommended_product` 契约

### 7.1 现状与风险

当前结构化对象要求 `product_code` 非空，但 legacy 字符串会被转换成：

```json
{
  "product_code": "",
  "product_name": "美东大客户空派专线"
}
```

这能保持旧字符串流程完成，但形成了一个“结构化对象却没有产品编码”的内部结果。若下游以 `product_code` 查产品，会得到不可关联的数据。

### 7.2 决策门

在实现前选择并记录一种正式契约：

**方案 A（推荐，显式兼容）**

```ts
type RecommendedProduct = {
  product_code: string | null
  product_name: string
  source: 'provider_object' | 'legacy_string'
}
```

结构化 Provider 结果要求非空 code/name；旧字符串映射为 `product_code: null`、`source: 'legacy_string'`。所有消费者必须能处理 `null`。

**方案 B（严格结构化）**

只接受 `{ product_code, product_name }`，拒绝 legacy 字符串，同时更新 Provider/system prompt 和调用方。

**方案 C（保持联合类型）**

不做转换，所有下游显式处理 string/object；只有在消费者确实很少且已被测试覆盖时采用。

未完成决策前，不得把空字符串当作无声默认值继续扩大使用。

### 7.3 TDD 测试规格

- `HANDOFF-LEGACY-001`：结构化对象按最终契约保存并生成事件。
- `HANDOFF-LEGACY-002`：legacy 字符串按最终契约保存，明确 code 缺失的表达方式。
- `HANDOFF-LEGACY-003`：缺 code/name、空对象、空字符串按最终契约失败或被明确拒绝。
- `HANDOFF-LEGACY-004`：任务结果、事件和任何 UI 消费形态一致，不出现一个地方是字符串、另一个地方是伪结构化空 code。

## 8. 推荐执行顺序

1. M-01 旧数据库迁移：先解决默认运行数据仍错误的问题。
2. M-02 联系人状态：补齐业务前置条件并防止实际建联越权。
3. M-03 smoke 入口：让 Windows 证据可发现、可运行、可清理。
4. M-04 handoff 契约：先完成决策，再写 Red/Green，避免反复改类型。
5. 运行完整门禁并重新出具审核报告。

每个任务都必须遵守：

```text
先写失败测试并实际确认 Red；再做最小修复；再运行目标测试、回归测试和必要的构建/smoke。
如果 Red 已因现有改动而直接通过，记录 pre-existing green，不得回滚或人为制造失败。
任何未实际运行的测试只能标为未验证，不能标为 pass。
```

## 9. 最终验收门禁

- `LEGACY-PUBLISH-001` 至 `004` 全部通过，且仓库默认旧库状态不再错误。
- `OUTREACH-CONTACT-001` 至 `009` 全部通过，非 `contactable` 联系人不会产生 draft/stage 5。
- `SMOKE-ENTRY-001` 至 `006` 全部通过，且有真实 Windows HTTP 证据。
- `HANDOFF-LEGACY-*` 按已选方案通过，不能保留未说明的空 `product_code`。
- `npm.cmd test`、`npm.cmd run test:smoke`、`npm.cmd run typecheck`、`npm.cmd run build` 均通过。
- `git diff --check` 通过。
- 现有用户改动未被覆盖，测试没有写入演示数据库，测试完成后无残留进程/端口。
- 修复报告列出每个测试 ID 的 Red 命令、Green 命令、实际输出摘要和变更文件。

## 10. 本阶段不做

- 不直接修改当前 `data/acquisition-demo.sqlite` 来伪造迁移结果。
- 不通过全量 reset 绕过旧数据库迁移测试。
- 不把 smoke 从默认配置排除后再用“报告已通过”替代实际 Windows 证据。
- 不在没有契约决策的情况下继续扩大 `recommended_product` 的隐式转换。
- 不提交、推送或创建 PR，除非后续收到明确授权。
