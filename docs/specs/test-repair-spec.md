# CAP Agent 测试修复规格（TDD 规划）

## 1. 文档目的

本文件用于规划 `codex/AHa-testing` 分支上的六项问题修复。当前阶段只产出规格与测试计划，不修改业务代码，也不新增测试实现。

问题核对基线为 GitHub `main` 的原始提交：

`65e213a64941131e7b2353dafb7ffb93fc762371`

后续开发必须按每个问题独立完成一次 TDD 循环：

1. 先写能够证明问题的失败测试（Red）。
2. 只做让该测试通过所需的最小修复（Green）。
3. 在不改变行为契约的前提下整理实现，并运行相关回归测试（Refactor/Regression）。

当前仓库的 `package.json` 已提供 `vitest run`、`npm run typecheck`、`npm run build` 命令，但尚未发现现有的 `test/spec` 文件。因此，后续实现需要先建立测试目录与隔离测试夹具。

## 2. 当前工作区约束

开始测试实现前，先记录一次 `git status --short --branch`，并保留当前已有改动：

- `.env.example`
- `nuxt.config.ts`
- `server/utils/db.ts`
- 未跟踪的 `CAP_Agent_问题定位报告_2026-07-28.html`

这些文件不是本规格授权的修改对象。不得通过 `reset --hard`、`checkout` 或删除数据库文件来清理工作区。测试不得使用或写入 `data/acquisition-demo.sqlite`、`data/promptfoo.sqlite` 等现有演示数据库。

当前分支部分代码可能已经与上述 `main` 基线不同。若某个 Red 用例在当前工作区直接通过，必须记录为“已有改动导致的 pre-existing green”，仍需检查实现是否满足本规格的完整契约，不得跳过对应回归测试。

## 3. 测试基础设施与测试原则

### 3.1 隔离夹具

建议建立以下结构；名称可调整，但职责必须保留：

```text
tests/
  fixtures/
  helpers/
  unit/
  integration/
  smoke/
```

- 每个测试使用独立的内存 SQLite 或临时数据库文件，并在测试结束后关闭/清理连接。
- 数据库夹具至少覆盖 `customers`、`contacts`、`products`、`match_results`、`opportunities`、`email_drafts`、`opportunity_events`、`agent_tasks` 所需字段。
- 不依赖演示种子的随机状态；需要 `opp-06` 时，在测试夹具中明确写出 `contact_id = ''`、初始 `stage = 4`、非空 `blocker`。
- 时间使用固定 demo clock，断言时间时只断言明确的业务变化，不使用真实墙钟时间。
- Agent 测试通过 mock Provider 返回固定 JSON，不发起真实网络请求，不读取 `.env` 中的真实密钥。
- 若现有单例 `getDb()` 不便于隔离，应增加最小的测试注入/数据库工厂 seam；不要在测试中通过修改生产数据库路径或导入真实数据实现隔离。

### 3.2 断言原则

- 一个测试只验证一个业务行为，失败信息要能指向具体契约。
- 正向断言与负向断言成对出现：不仅验证正确记录被写入，也验证不应写入的记录、事件、阶段变化不存在。
- 优先断言公开行为（数据库最终状态、任务状态、HTTP 响应、事件），不通过复制私有实现来测试 SQL 字符串。
- Agent 结果的 schema 测试必须验证“解析失败不会发生任何业务落库”；不能只断言抛出了异常。
- API 测试必须覆盖成功、无目标记录、非法输入和重复调用等边界，避免只测试 happy path。
- 测试执行顺序不应影响结果；单测可单独运行，集成测试可重复运行。

## 4. 六项问题的测试规格

### 4.1 产品发布状态：BY004 不得被视为已发布

**业务契约**

- `quote_ready` 与 `published` 是两个独立字段。
- BY004 的种子数据应为 `quote_ready = false`、`published = false`。
- PMS 快照中的 `published` 也必须为 `false`，不能由 SQL 或快照生成逻辑硬编码为 `true`。
- 产品匹配上下文只能包含 `published = 1` 的产品。
- 即使 Provider 越权返回 `BY004`，落库前仍必须再次校验产品处于已发布状态。

**Red 用例**

- `PRODUCT-PUBLISH-001`：初始化产品种子后查询 `BY004`，断言 `quote_ready = 0` 且 `published = 0`，并断言 `pms_snapshot_json.published === false`。该用例必须能区分两个字段，不能只断言其中一个。
- `PRODUCT-PUBLISH-002`：构造一个客户并生成 product matching 上下文，断言产品列表不含 `BY004`，同时仍包含至少一个已发布产品。
- `PRODUCT-PUBLISH-003`：mock Provider 返回包含 `BY004` 的匹配结果，运行匹配任务后，断言 `match_results` 中没有 BY004 对应记录；若全部候选均为未发布产品，任务/机会不得被标记为“已完成有效匹配”。

**Green 验收**

- 产品 seed 的每一行显式携带发布状态，SQL 参数顺序与列顺序一致。
- `targetContext` 与 `applyResult` 两个边界都保护发布状态，不能只修 seed。
- 已发布产品的既有匹配行为、版本号和排序不受影响。

### 4.2 无联系人时不得生成空收件人 draft，也不得推进到 stage 5

**业务契约**

- 只有存在有效联系人且收件地址非空时，`outreach_drafting` 才能写入 `email_drafts`。
- 无联系人、联系人不存在、邮箱为空或邮箱不可用，均视为建联前置条件不满足。
- 前置条件不满足时，不写入 `recipient = ''` 的 draft，不推进机会到 `stage = 5`，不清空原有 `blocker`。
- 任务应以可重试的失败/阻塞结果结束，并保留明确原因，例如 `missing_contact`；具体错误文案可以按现有项目语言规范确定。

**Red 用例**

- `OUTREACH-CONTACT-001`：使用 `opp-06`（`contact_id` 为空、初始 stage 为 4、已有 blocker），mock 中文建联结果，执行 Agent 任务，断言该机会没有新增 draft，数据库中不存在空收件人 draft，stage 仍为 4，blocker 仍非空。
- `OUTREACH-CONTACT-002`：使用有 `contact_id` 但联系人 email 为空的机会，断言结果与无联系人完全一致。
- `OUTREACH-CONTACT-003`：使用有效联系人和非空 email，断言只新增一个 draft，recipient 等于该 email，且中文建联结果按原契约推进到 stage 5。
- `OUTREACH-CONTACT-004`：失败路径断言没有产生“draft_ready”成功事件，任务错误中包含可定位的缺联系人原因；已有历史 draft 不得被删除或覆盖。

**Green 验收**

- 联系人和收件地址校验发生在所有 draft 写入和机会更新之前。
- 事务边界保证“写 draft、推进 stage、清 blocker”不会出现部分提交。
- 英文 draft 的现有行为也必须遵守不产生空 recipient 的不变量；不能只在中文分支加判断。

### 4.3 `customer_type` 只能使用业务枚举

**业务契约**

Agent 画像结果的 `customer_type` 允许且仅允许以下值：

```text
freight_forwarder_partner
ecommerce_seller
exporter
trading_company
direct_shipper
unknown
```

Provider 返回其他值（例如 `high_value_partner`）、空字符串、大小写变体或非字符串时，结果校验失败，不得写入 `customers.customer_type`，也不得触发画像完成事件或后续自动匹配。

**Red 用例**

- `PROFILE-TYPE-001`：对上述六个合法值逐一运行画像结果，断言 schema 通过，且客户字段准确保存。
- `PROFILE-TYPE-002`：Provider 返回 `high_value_partner`，断言任务失败；客户原 `customer_type`、`ai_profile_json`、`ai_profile_status` 均不变，且没有 `profile_completed` 事件。
- `PROFILE-TYPE-003`：分别返回空字符串、`Freight_Forwarder_Partner`、数字和 `null`，均断言被拒绝并且没有任何画像落库。
- `PROFILE-TYPE-004`：合法画像结果仍按原逻辑更新活跃机会阶段并触发后续 product matching；该用例用于防止过度收紧 schema 造成正常流程回归。

**Green 验收**

- 枚举定义只有一个业务来源，schema 与 system prompt 使用同一组值。
- 解析必须先于 `applyResult`，数据库更新只能接收已通过枚举校验的结果。
- 官网身份接口中用户输入的 `customerType` 属于另一条输入契约，本次不应未经产品确认擅自复用 Agent 枚举；如后续决定统一，另立测试与变更记录。

### 4.4 重匹配不得使 accepted 匹配变 stale

**业务契约**

- 自动重匹配只能使未被人工接受的匹配进入 stale。
- `status = 'accepted'` 的匹配是人工确认结果，重匹配不能修改其 `stale` 值，也不能降级其 status。
- 同一客户下，`proposed`、`rejected` 等非 accepted 结果仍按既有重匹配规则处理。

**Red 用例**

- `REMATCH-STALE-001`：为同一客户准备一个 `accepted/stale=0` 和一个 `proposed/stale=0` 的匹配，调用 `rematch.post`，断言 accepted 仍为 `stale=0`，proposed 变为 `stale=1`。
- `REMATCH-STALE-002`：准备 `accepted/stale=1` 的历史记录后重匹配，断言它仍为 1，证明接口不会借重匹配把 accepted 记录重新激活或重写。
- `IDENTITY-STALE-001`：走 `identity.post` 的既有客户路径，使用相同 accepted/proposed 夹具，断言 accepted 保持不 stale，非 accepted 记录按规则失效。
- `REMATCH-STALE-003`：验证重匹配仍会创建/返回预期 Agent task，且不会因为排除 accepted 而漏掉新的未接受候选。

**相邻路径复核**

`quote.post.ts` 当前也存在客户级别的匹配失效 SQL。实现阶段必须先为该路径补充 characterization test，并明确其与 accepted 的业务语义；若产品规则是“任何重新获得的客户事实都不能自动撤销人工接受”，则同样排除 accepted。若业务允许报价变更撤销 accepted，必须在代码与测试中明确记录这一例外，不能让三条路径隐式不一致。

**Green 验收**

- `rematch.post.ts` 与 `identity.post.ts` 的失效条件显式排除 accepted。
- 更新条件使用 `status` 的业务值，而不是依赖结果排序或前端过滤。
- 同一 SQL 策略尽量复用，避免后续接口再次出现 unconditional stale update。

### 4.5 `recommended_product` 兼容 Provider 的对象结果

**业务契约**

Provider 可能返回旧式字符串，也可能返回结构化对象。结构化对象至少包含：

```json
{
  "product_code": "BY002",
  "product_name": "美东大客户空派专线"
}
```

建议将后端内部契约规范化为结构化对象，同时兼容非空字符串输入；若选择保持联合类型，也必须明确所有下游消费者如何读取，不能让每个消费者自行判断。

**Red 用例**

- `HANDOFF-CONTRACT-001`：mock `handoff_summary` 返回题述对象，断言 schema 通过，任务完成，并写入交接摘要事件；不能在结果 schema 阶段失败。
- `HANDOFF-CONTRACT-002`：返回非空旧式字符串，断言兼容策略按约定规范化/保留，任务同样完成。
- `HANDOFF-CONTRACT-003`：返回缺少 `product_code`、缺少 `product_name`、空对象和空字符串，断言任务失败且不写入 `handoff_summary` 事件。
- `HANDOFF-CONTRACT-004`：断言任务 `result_json` 与事件数据中的推荐产品（若事件扩展该字段）使用统一形态，避免 Provider 形态泄漏到 UI 或持久化消费者。

**Green 验收**

- `handoffSchema` 明确表达字符串兼容策略与对象字段约束。
- 成功解析后能够继续执行交接摘要落库和事件生成流程。
- 不改变 `summary`、`customer_need`、`evidence`、`risks`、`next_steps` 的既有校验要求。

### 4.6 Windows Nitro 下 xlsx 模块加载兼容性

**业务契约**

- 在 Windows 文件路径和 Nitro dev server 环境下，加载任何 API（尤其 `/api/state`）不得因 `xlsx` 的 ESM/CommonJS 加载方式抛出 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。
- Excel/CSV 导入仍需能解析首个工作表并返回正常统计结果。
- 该问题归属 `server/api/import/customers.post.ts` 的模块加载，不得把修复错误归因于 `server/api/state.get.ts`。

**Red 用例与运行方式**

- `IMPORT-XLSX-001`（Windows Nitro smoke）：用临时数据库启动 Nuxt/Nitro dev server，访问 `/api/state`，断言 HTTP 200 且响应为 JSON；失败时记录完整 stderr，尤其确认是否为 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。
- `IMPORT-XLSX-002`（Windows Nitro import）：使用包含一行客户数据的真实 xlsx buffer 发送 multipart 请求到导入接口，断言 HTTP 200、`created = 1`，并断言客户/联系人记录正确写入隔离数据库。
- `IMPORT-XLSX-003`：执行 `npm run build`，再以构建后的 Nitro 产物启动一次最小 HTTP smoke；访问 `/api/state` 和导入接口均不得出现模块加载错误。
- `IMPORT-XLSX-004`：非法或超大文件仍返回既有 400 业务错误，证明兼容性修复没有绕过文件校验。

**Green 验收**

- 采用在 Windows Nitro 可工作的模块加载方式（具体实现由修复阶段决定），并保持 `xlsx` 的读表行为不变。
- 测试重点是运行时行为，不以“源码中必须出现某个 import 写法”作为唯一断言。
- Linux/macOS CI 至少运行构建和导入集成测试；Windows runner 必须运行上述 HTTP smoke，不能用 Linux 通过替代 Windows 证据。

## 5. 推荐的 TDD 执行顺序

按依赖和风险从底层数据契约到运行时 smoke 执行：

1. 产品 seed 与 Agent 匹配发布边界（4.1）。
2. 无联系人建联前置条件（4.2）。
3. Agent 画像枚举校验（4.3）。
4. 官网 rematch/identity 的 accepted stale 保护（4.4）。
5. handoff Provider 输出契约（4.5）。
6. Windows Nitro xlsx 运行时加载（4.6）。

每一项在合并到下一项前必须满足：新增 Red 用例曾在修复前失败、修复后通过；同一文件的相关既有测试通过；没有用跳过测试、放宽断言或修改 fixture 规避失败。

## 6. 验证门禁

实现完成后按以下层次执行：

```powershell
npm test -- tests/unit/<target>.test.ts
npm test -- tests/integration/<target>.test.ts
npm test
npm run typecheck
npm run build
```

Windows Nitro smoke 需要单独在 Windows 环境启动/停止 dev server，记录端口、进程退出码、HTTP 状态码和 stderr。测试结束后确认临时数据库、临时上传文件和 server 进程均已清理。

最终交付前检查：

- 六组测试 ID 全部通过，且每组都有至少一个失败路径断言。
- 不再存在空 recipient draft。
- accepted 匹配在所有纳入范围的失效路径中保持业务约定。
- 非法 `customer_type` 与非法 handoff 结果都不会落库。
- BY004 的 `published`、PMS 快照和 Agent 匹配上下文保持一致。
- Windows Nitro smoke 与构建验证均通过。
- `git diff` 只包含后续明确授权的代码/测试/文档改动；本阶段只应新增本规格文档。

## 7. 本阶段明确不做的事项

- 不在本阶段修改 `server/utils/agent.ts`、`server/utils/db.ts`、官网接口或导入接口。
- 不在本阶段新增、执行或提交测试实现。
- 不升级 `xlsx`、Nuxt 或 Vitest 依赖来掩盖问题。
- 不修改报告、环境配置和现有演示数据库。
- 不把 `/api/state` 当作 xlsx 问题的代码归属；它只作为最先暴露模块加载错误的 smoke 入口。

## 8. 可直接交给其他模型的操作提示词

以下提示词面向具备仓库读写和命令执行能力的模型。默认工作目录为 `D:\\by56_CAP_Agent`。提示词之间有先后依赖：模型没有给出 Red 证据前，不得进入 Green；单项没有通过回归前，不得开始下一项。

### 8.1 总控提示词：启动本次修复

```text
你现在负责在 D:\\by56_CAP_Agent 的 codex/AHa-testing 分支上修复 CAP Agent 暴露的问题。

先完整阅读 docs/test-repair-spec.md，并以 GitHub main 原始提交
65e213a64941131e7b2353dafb7ffb93fc762371 作为问题核对基线。

本次必须遵循严格 TDD：每个问题先新增最小失败测试并实际运行确认 Red，再做最小业务修复变为 Green，最后运行该问题回归和完整验证。一次只处理一个问题，顺序为：
1. BY004 published 状态与匹配边界；
2. 无联系人不得生成空 recipient draft、不得推进 stage 5；
3. customer_type 业务枚举；
4. rematch/identity 不得让 accepted match 变 stale；
5. recommended_product Provider 契约兼容；
6. Windows Nitro 下 xlsx 加载 smoke。

开始任何写操作前：
- 执行并记录 git branch --show-current 和 git status --short --branch；
- 保留现有 .env.example、nuxt.config.ts、server/utils/db.ts 改动以及未跟踪报告；
- 不得使用 git reset --hard、git checkout、删除演示数据库或覆盖用户已有改动；
- 不得写入 data/acquisition-demo.sqlite、data/promptfoo.sqlite 或真实密钥；
- Agent 测试必须 mock Provider，不得调用真实 LLM 或外网。

测试必须使用隔离 SQLite、固定时间和可重复 fixture。优先断言公开业务结果：数据库状态、任务状态、事件、HTTP 响应；同时断言不应发生的落库、阶段推进和事件。不要用跳过测试、放宽断言或修改 fixture 来消除失败。

每一步向我汇报：
1. 本步目标和测试 ID；
2. Red 命令及失败摘要；
3. 修改了哪些文件、为什么是最小修改；
4. Green 与回归命令及结果；
5. 当前 git diff/status 和仍未解决的风险。

如果当前工作区已有修改使 Red 用例直接通过，标记为 pre-existing green，不要为了制造失败而回滚或反向修改代码；继续检查完整契约并补齐缺失的负向断言。没有实际命令输出，不得声称测试通过。
```

### 8.2 预检提示词：只检查环境与测试入口

```text
先不要修改业务代码，也不要新增测试实现。请在 D:\\by56_CAP_Agent 完成修复前预检：

1. 确认当前分支必须是 codex/AHa-testing；
2. 读取 docs/test-repair-spec.md、package.json、相关 server 文件；
3. 记录 git status --short --branch，并标出哪些改动属于已有用户内容；
4. 确认 Node/npm/Vitest/Nuxt 命令是否可用，以及当前是否存在 tests/ 目录或现有 test/spec 文件；
5. 检查 getDb() 的单例和 demo seed 是否需要最小测试注入 seam；
6. 说明如何使用隔离 SQLite 和 mock OpenAI Provider；
7. 为六个问题列出预计测试文件、测试 ID、Red 命令和 Green 验证命令。

只输出预检报告，不要通过 reset、checkout、删除文件或修改配置来修复环境。若发现必须新增测试基础设施，请提出最小方案并等待进入第一个问题的 TDD 循环。
```

### 8.3 通用单项 TDD 提示词

将下面模板中的 `<问题>`、`<范围>`、`<测试 ID>` 和 `<验收条件>` 替换后，每次只处理一个问题：

```text
只处理本轮的 <问题>，代码范围限定为 <范围>，测试 ID 为 <测试 ID>。

阶段一：Red
- 先阅读规格文档对应章节和现有实现；
- 编写最小、隔离、可重复的失败测试；
- 不先改生产代码；
- 运行单个测试文件，保存完整命令和失败输出；
- 失败必须由目标业务缺陷引起，而不是导入、端口、路径或 fixture 错误。

阶段二：Green
- 只有 Red 已确认后，才做最小生产代码修改；
- 保留现有公共行为和错误处理，不顺便重构无关逻辑；
- 重新运行同一个测试，确认通过；
- 再运行该问题的同组测试和受影响的既有测试。

阶段三：Regression
- 运行 npm test、npm run typecheck、npm run build 中本轮需要的命令；
- 检查没有空记录、错误事件、错误 stage、状态降级或真实网络调用；
- 检查 git diff，只保留本轮必要的测试和生产代码；
- 汇报 Red/Green 命令、文件变更、测试结果和未决风险。

若 Red 直接通过，记录 pre-existing green，禁止回滚用户改动或人为制造失败；若测试暴露的是规格未定义的业务决策，暂停该分支并明确指出决策点。
```

### 8.4 问题一提示词：修复 BY004 发布状态

```text
执行规格 4.1，只处理 BY004 的 published 状态和产品匹配链路。

先写并运行 PRODUCT-PUBLISH-001、PRODUCT-PUBLISH-002、PRODUCT-PUBLISH-003：
- 分别断言 quote_ready 与 published；
- 断言 BY004 的 PMS 快照 published 为 false；
- 断言 product matching context 不包含 BY004；
- 即使 Provider 返回 BY004，也不能产生 match_results 记录。

确认 Red 后再做最小修复：检查产品 seed 的 tuple、INSERT 参数、PMS snapshot，以及 targetContext/applyResult 的 published 边界。不要只改 seed 而放弃落库前校验，也不要改变已发布产品的排序、版本或评分逻辑。

如果所有模型候选都是未发布产品，必须验证不会伪装成有效匹配完成；不要用“插入后再标 stale”代替“不落库”。完成后运行该组测试、相关 Agent 测试、typecheck，并报告 BY004 的数据库值、上下文值和最终匹配值。
```

### 8.5 问题二提示词：阻止无联系人建联

```text
执行规格 4.2，只处理 outreach_drafting 的联系人前置条件。

先写并运行 OUTREACH-CONTACT-001 至 OUTREACH-CONTACT-004。至少覆盖：
- opp-06 的空 contact_id；
- contact_id 存在但 email 为空；
- 有效联系人和非空 email 的成功路径；
- 失败时没有空 recipient draft、没有 draft_ready 事件、stage 不到 5、原 blocker 不被清空。

确认 Red 后再修复。联系人和 email 校验必须发生在任何 draft INSERT、stage 更新和 blocker 清除之前；失败路径要能让任务安全失败或阻塞并保留可定位原因。不要只对中文分支加判断，英文 draft 也不能有空 recipient。不要删除历史 draft，也不要用数据库默认值掩盖缺联系人。

验证写 draft 与机会状态更新没有部分提交；运行本组测试及 Agent 任务回归。汇报失败任务状态、机会 stage/blocker、draft 数量和事件数量。
```

### 8.6 问题三提示词：限制 customer_type 枚举

```text
执行规格 4.3，只处理 Agent customer profiling 的 customer_type 契约。

先写并运行 PROFILE-TYPE-001 至 PROFILE-TYPE-004。合法集合必须严格是：
freight_forwarder_partner、ecommerce_seller、exporter、trading_company、direct_shipper、unknown。

负向用例至少使用 high_value_partner、空字符串、大小写变体、数字和 null，并验证解析失败后 customers.customer_type、ai_profile_json、ai_profile_status、profile_completed 事件和后续自动匹配都没有错误变化。正向用例要证明六个合法值仍能完整落库。

确认 Red 后再把 schema 和 system prompt 的业务集合统一到单一来源。校验必须在 applyResult 之前完成。不要把官网 identity.post 的用户输入 customerType 未经单独决策强行改成同一契约，也不要通过把未知值映射成 unknown 来隐藏 Provider 错误，除非规格另有明确批准。
```

### 8.7 问题四提示词：保护 accepted 匹配

```text
执行规格 4.4，只处理匹配失效策略。

先写并运行 REMATCH-STALE-001、REMATCH-STALE-002、REMATCH-STALE-003 和 IDENTITY-STALE-001：同一客户同时准备 accepted、proposed 记录，验证 rematch.post 和 identity.post 都只让非 accepted 记录 stale，accepted 的 stale/status 保持不变。

先对 quote.post.ts 做 characterization test，并明确它与 accepted 的业务语义；不能无记录地让三条路径行为分裂。若规则为人工 accepted 不得自动撤销，则 quote 路径也必须排除 accepted；若存在业务例外，必须写进测试和最终报告。

确认 Red 后再收紧 SQL 的 WHERE 条件或抽取共享失效策略。不要通过前端过滤、排序、删除 accepted 记录或先全部 stale 再恢复 accepted 来实现。验证重匹配任务仍被创建，新的未接受候选仍能产生。
```

### 8.8 问题五提示词：兼容 recommended_product

```text
执行规格 4.5，只处理 handoff_summary 的 Provider 输出契约。

先写并运行 HANDOFF-CONTRACT-001 至 HANDOFF-CONTRACT-004。必须验证题述对象：
{"product_code":"BY002","product_name":"美东大客户空派专线"}
能够完成 schema 校验、任务落为 completed、交接摘要事件正常写入；同时验证非空旧式字符串的兼容行为和缺字段/空值的失败行为。

确认 Red 后再实现明确的联合输入与规范化输出策略。优先让内部持久化和事件消费者使用统一结构，禁止让每个消费者自行猜测字符串或对象。不要删除 evidence、risks、next_steps 等既有约束，也不要连接真实 Provider。

最终检查 result_json 与事件数据的推荐产品形态一致；失败解析不得产生 handoff_summary 事件或部分落库。
```

### 8.9 问题六提示词：修复 Windows Nitro xlsx 加载

```text
执行规格 4.6，只处理 server/api/import/customers.post.ts 的 Windows/Nitro 模块加载兼容性。

先在 Windows 环境建立 IMPORT-XLSX-001 至 IMPORT-XLSX-004：
- 临时数据库启动 Nuxt/Nitro dev server 后访问 /api/state，必须 HTTP 200 且不能出现 ERR_UNSUPPORTED_ESM_URL_SCHEME；
- multipart 上传一行 xlsx，必须成功创建客户和联系人；
- npm run build 后启动构建产物，再 smoke /api/state 和导入接口；
- 非法/超大文件仍返回既有 400。

问题归属是 xlsx 模块被 Nitro 加载的方式，不要修改 server/api/state.get.ts 来掩盖错误。确认 Red 后再采用兼容 Windows Nitro 的最小加载修复，保持首个工作表解析、字段映射、大小限制和错误响应不变。运行结束必须清理 server 进程、临时文件和临时数据库。

Linux 通过不能替代 Windows smoke 证据；汇报 Node 版本、启动命令、HTTP 状态码、退出码和 stderr 摘要。
```

### 8.10 最终验证与交付提示词

```text
六个问题全部完成后，执行最终验证，不再新增业务范围：

1. 运行六组测试 ID 对应的 targeted tests；
2. 运行 npm test、npm run typecheck、npm run build；
3. 在 Windows 运行 Nitro /api/state 和 xlsx import smoke；
4. 检查临时资源已清理，测试没有真实网络调用；
5. 检查 git diff --check、git status --short --branch，确认已有用户改动未被覆盖；
6. 逐条对照本文件第 6 节验收门禁。

请用下表格式汇报，不要只说“全部通过”：

| 测试组 | Red 证据 | Green/回归命令 | 结果 | 变更文件 | 未决风险 |
|---|---|---|---|---|---|
| PRODUCT-PUBLISH | 命令 + 失败摘要 | 命令 + 结果 | pass/fail | path | none/说明 |
| OUTREACH-CONTACT | 命令 + 失败摘要 | 命令 + 结果 | pass/fail | path | none/说明 |
| PROFILE-TYPE | 命令 + 失败摘要 | 命令 + 结果 | pass/fail | path | none/说明 |
| REMATCH/IDENTITY | 命令 + 失败摘要 | 命令 + 结果 | pass/fail | path | none/说明 |
| HANDOFF-CONTRACT | 命令 + 失败摘要 | 命令 + 结果 | pass/fail | path | none/说明 |
| IMPORT-XLSX | 命令 + 失败摘要 | 命令 + 结果 | pass/fail | path | none/说明 |

任何测试未运行、环境未验证或规格存在业务歧义，都必须标为 blocked/未验证，不能标为 pass。不要自行提交、推送或创建 PR，除非收到明确授权。
```

### 8.11 阻塞处理提示词

```text
你遇到了阻塞。请停止扩大修改范围，并按以下格式诊断：

- 阻塞类型：测试设计 / 运行环境 / 生产代码 / 业务决策；
- 已执行的完整命令；
- 最早失败的输出和是否可重复；
- 已排除的原因；
- 是否触及现有用户改动；
- 不改变业务语义的安全替代方案；
- 需要用户决定的唯一问题（如有）。

不要通过跳过测试、提高超时、放宽 schema、改写 fixture、删除数据库或回滚工作区来隐藏阻塞。若只是当前工作区已有修复导致 Red 不再失败，记录 pre-existing green 并继续做契约完整性检查；若是 Windows-only 问题，在 Windows smoke 前不要宣称已解决。
```
