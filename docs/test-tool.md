# 测试工具选型与治理手册

> 基于 [test-tool-governor](../README.md) skill 的标准模板。本文档定义 CAP_Agent
> 项目的测试工具栈、版本、权限、凭据、资产生命周期和安全门禁，是仓库内"选哪个工具、如何安全使用、如何长期维护"的唯一事实源。

## 1. 工具栈总览

| 层 | 工具 | 版本 | 用途 | 选型理由 |
| --- | --- | --- | --- | --- |
| 测试运行器 | vitest | `^3.2.4` | unit / integration / agent-eval 结构护栏 / smoke | 与 Nuxt 3 同源、原生 ESM/TS、watch 模式快 |
| TypeScript 校验 | vue-tsc + `nuxt typecheck` | `^2.2.10` | 类型门禁 | Nuxt 官方推荐 |
| 数据库 | `node:sqlite` (DatabaseSync) | Node `>=22` 内置 | 演示库 + 测试隔离库 | 零依赖、内置；与 Nitro 同步 |
| LLM SDK | `openai`（OpenAI 兼容） | `^5.12.2` | Agent 模型调用 | 标准 OpenAI 兼容协议，DeepSeek/v4-pro/自建均覆盖 |
| Excel | `xlsx`（CommonJS） | `^0.18.5` | 客户/产品批量导入 | PoC 必选；用 `createRequire(import.meta.url)` 解决 Windows ESM 加载 |
| 邮件 | `nodemailer` | `^7.0.5` | SMTP 发送（白名单内） | 演示发件，强制 allowlist |
| WebSocket | nitro websocket experimental | off | 关闭 | 当前 1.5s 轮询已够用 |
| UI 组件 | `@arco-design/web-vue` | `^2.57.0` | 运营后台 + 虚拟官网 | 内部演示选定 |

> **版本管理**：`package.json` 用 caret 锁 minor，`package-lock.json` 锁 patch；任何升级必须单独 PR 并附"为什么现有版本不够"的说明。

## 2. 配置文件

| 路径 | 职责 | 关键参数 |
| --- | --- | --- |
| `vitest.config.ts` | 默认套件：unit + integration | `environment: 'node'`，`include: ['tests/unit/**', 'tests/integration/**']`，`fileParallelism: false`，`testTimeout: 60_000` |
| `vitest.smoke.config.ts` | Windows Nitro dev/build 实机冒烟 | `include: ['tests/smoke/**']`，`testTimeout: 600_000`（长耗时），`fileParallelism: false` |
| `nuxt.config.ts` | 运行时配置 + Nitro | LLM/SMTP/emailAllowlist 等敏感配置全部走 `runtimeConfig`；`vite.server.watch.ignored` 排除 `data/`、`*.sqlite` |
| `tsconfig.json` | TypeScript 严格模式 | `strict: true` |
| `.env.example` | 凭据占位（**不可写真实密钥**） | `LLM_API_KEY` 留空；`EMAIL_ALLOWLIST=test@example.com` 默认值 |

### 2.1 显式拒绝

- 默认 `vitest.config.ts` **不**包含 `tests/smoke/**`——smoke 必须显式 `--config vitest.smoke.config.ts` 启动，避免 CI 默认跑长耗时。
- `nuxt.config.ts` 关闭 `websocket: false`、关闭 devtools——避免资源浪费和潜在信息泄露。
- 不安装 `pnpm`/`yarn`——项目只用 `npm`（README §本地启动 明确要求）。

## 3. 测试辅助层（`tests/helpers/`）

| 文件 | 职责 | 维护边界 |
| --- | --- | --- |
| `setup.ts` | Nuxt/Nitro auto-import shim | 写 `useRuntimeConfig` / `defineEventHandler` / `createError` / `readBody` / `readMultipartFormData` / `getRouterParam`；**测试态密钥**（`http://127.0.0.1:9`、`test-key-not-real`）必须保留占位，禁止写真值 |
| `db.ts` | 临时 SQLite 隔离夹具 + agent hook | 暴露 `useIsolatedDb(seed?)`；每次 `mkdtempSync` + `afterEach` 清理；调用 `setDbForTests` / `resetAgentTestHooks` / `setDeferAgentExecutionForTests` 必须**配套出现**，禁止只清一半 |
| `nitro-smoke.ts` | Windows Nitro 进程启停 + 端口/锁清理 + multipart/xlsx 构造 | `killPidTree` 必须 `taskkill.exe /T /F` + SIGKILL 双保险；`releaseNuxtLock` 删除 `.nuxt/nuxt.lock`；`assertPortClosed` 循环重试 20 次 × 300ms；`allocateLoopbackPort` 走 OS 分配，禁止硬编码端口 |

## 4. 测试目录与用例分布

| 目录 | 数量 | 类型 | 治理要求 |
| --- | ---: | --- | --- |
| `tests/unit/` | 16 文件 | 纯函数 + schema + 业务规则 | 必须 ≤100ms 级别；不允许起服务 |
| `tests/integration/` | 5 文件 | Nitro endpoint + SQLite | 允许 `useIsolatedDb`；不允许占用 3100 端口 |
| `tests/smoke/` | 1 文件 | Windows Nitro `nuxt dev` + `nuxt build` 实进程 | 随机 loopback 端口 + 严格进程清理；`npm run test:smoke` 单独入口 |
| `tests/agent-evaluation/` | 1 JSON（72KB） | 离线评测数据集 | 见 `docs/agent-evaluation.md` |
| `tests/helpers/` | 3 文件 | 跨层级共享 | 见 §3 |

## 5. 凭据 / 权限 / 敏感数据

### 5.1 凭据治理

- **真实 LLM 密钥**：`LLM_API_KEY` 只在本地 `.env` 中出现，**禁止**写入 `.env.example`、源码、测试、CI。
- **真实 SMTP 凭据**：`SMTP_PASS` 同上规则；`EMAIL_ALLOWLIST` 默认 `test@example.com`，发送前强校验，不在白名单内拒绝落库并返回错误。
- **测试态密钥**：`tests/helpers/setup.ts` 中出现的 `test-key-not-real`、`http://127.0.0.1:9` 等必须保持占位字面值，不得替换为任何真实/开发环境值。

### 5.2 权限与目录

- 测试不写入 `data/acquisition-demo.sqlite`、`data/promptfoo.sqlite`——必须复制到临时目录或用 `useIsolatedDb` 创建临时文件。
- 默认 `.gitignore` 已排除 `.env`、`data/*.sqlite*`、`.nuxt/`、`.output/`、`node_modules/`。
- 长耗时 smoke 必须在独占开发工作区执行，避免与同目录其他 Nuxt 进程并行抢端口。

### 5.3 安全否决项（与 skill 一致）

- 测试工具**禁止**对生产执行压测、删除、修改、注入——审批亦不能解除。
- 脚本默认禁止指向生产；环境变量缺失时不得回退到生产。
- 不允许在仓库、日志、CI artifacts 中明文保存真实密钥、Token、隐私数据。
- Agent 离线评测不调用真实生产模型——核心计算 / 安全相关维度 100% 通过由"结构 + 用例 + 阈值"三层护栏保证，不依赖 LLM 评审作为唯一证据。
- CI 中的 `node scripts/agent-eval-report.mjs --check` 是评测集结构护栏，不是 LLM 输出评审。

## 6. 资产生命周期

| 资产 | 来源 | 版本/位置 | 维护频率 | 升级路径 |
| --- | --- | --- | --- | --- |
| `tests/agent-evaluation/core-regression.json` | 人工构造 + 线上回流 | 顶层 `version` 字段；用例 `dataset_version` 必须等于顶层版本 | 每次 Agent Prompt/模型/工具/规则变更 | `version` 升级 + 现有 100 用例迁移 + 增量补充；新增 mode 必须补 ≥20 用例 |
| 评测 reporter | `scripts/agent-eval-report.mjs` | 与评测集同源 | 与评测集同源 | 阈值字段与 `docs/agent-evaluation.md` §3 对齐 |
| 临时 SQLite | `tests/helpers/db.ts` | `mkdtempSync` 自动清理 | 每次 `afterEach` | 禁止把临时文件 commit |
| 临时上传 xlsx | `tests/helpers/nitro-smoke.ts` | 内存 Buffer | 每次 smoke 结束 | 禁止持久化 |
| Nitro dev/build 进程 | smoke 启动 | 进程级 | 每次 smoke 结束 | 严格 `cleanupSmokeRuntime` 清理 |

## 7. 工具脚本（`scripts/`）

| 脚本 | 入口 | 用途 | CI 用法 |
| --- | --- | --- | --- |
| `agent-eval-report.mjs` | `npm run test:agent-eval` | 评测集结构 + 阈值 + 用例数量护栏；输出 markdown 报告 | `--check` 模式失败时 `exit 1` |
| `agent-eval-report.mjs --stats` | 手动 | 统计每个 mode 的用例数、风险分布、采样数 | 仅供本地评审 |

## 8. CI 接入与门禁

```bash
# CI 必须通过的护栏（与 docs/release-regression.md §9 对齐）
npm run typecheck                              # 类型门禁
npm test                                       # 44+ 确定性测试（unit + integration + agent-eval 结构护栏）
npm run test:agent-eval                        # 评测集结构 + 9 阈值 + 用例数量 + ID 唯一
npm run test:smoke                             # Windows Nitro dev/build 实进程（长耗时）
```

`test:quality` = `typecheck && test && test:agent-eval`——CI 默认门禁；`test:smoke` 由维护者按需触发（具备进程管理权限的 Windows 环境）。

## 9. 引入新工具的检查清单

1. 现有工具是否真的不够？写出对比。
2. 是否命中 §5.3 安全否决项？命中即停止。
3. 是否影响现有 CI 链路？需要改 `package.json` scripts / `vitest.*.config.ts` / `tests/helpers/` 吗？
4. 维护成本、许可、CI 时间、迁移量、退出方案。
5. 在 `docs/test-process.md` 的阶段台账中登记变更。

## 10. 已知限制与待办

- **NFR 工具缺失**：性能/容量/可观测/无障碍相关工具尚未引入——量级未到（30+8+3 客户）。
- **UI 自动化缺失**：Playwright/Cypress 暂不引入——演示只在 Chrome 单浏览器。
- **正式 SMTP 服务**：PoC 走 `nodemailer` + 白名单；进入长期版本前需评估事务邮件服务。
- **真实 LLM CI 评测**：当前 `test:quality` 只能跑"结构护栏"，不能跑真实模型通过率——接入真实模型后再补评测执行框架。

---

**维护**：Mavis · **审核**：研发 · **下次复盘**：每次依赖升级前
