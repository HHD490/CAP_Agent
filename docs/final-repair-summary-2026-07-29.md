# CAP Agent 修复最终汇总报告（2026-07-29）

## 1. 发布结论

当前分支：`codex/AHa-testing`

审计结论：**Approve with notes**。本轮六类问题的修复代码、回归测试和 Windows Nitro 运行验证均已完成；在具备子进程管理权限的 Windows 环境中可进入提交和推送流程。

## 2. 修复范围

| 问题 | 最终处理 | 结果 |
|---|---|---|
| BY004 被错误标记为已发布 | seed 明确区分 `quote_ready` 与 `published`；BY004 为 `published=0`、PMS 快照 `published=false`；既有数据库增加幂等迁移；Agent 上下文和落库再次校验已发布产品 | 通过 |
| 无联系人生成空 draft 并推进 stage 5 | 以 `isValidOutreachContact` 统一校验联系人状态和非空邮箱；无效联系人不创建 draft、不推进 stage 5、不清 blocker；demo action 入口同步保护 | 通过 |
| Agent 输出写入任意 `customer_type` | `profileSchema` 使用单一业务枚举；非法 Provider 结果在 `applyResult` 前失败，不写画像、不写客户字段、不发完成事件、不触发自动匹配 | 通过 |
| accepted 匹配被重匹配标记 stale | 抽取 `markNonAcceptedMatchesStale`，覆盖 rematch、identity、demo customer/product 更新和 Agent 匹配路径；`accepted` 被排除 | 通过 |
| `recommended_product` 契约不兼容 | handoff schema 兼容对象和旧字符串两种 Provider 输出，并统一规范化为对象 | 通过 |
| Windows Nitro `xlsx` 加载错误 | 当前分支既有提交 `79a20b6` 已使用 `createRequire` 兼容 `xlsx@0.18`；本轮 smoke 对 `/api/state` 和 Excel 导入进行实机验证，无 `ERR_UNSUPPORTED_ESM_URL_SCHEME` | 通过（既有修复回归） |

## 3. 验证结果

| 命令 | 结果 |
|---|---|
| `npm.cmd test` | 10 个测试文件、44 个测试全部通过 |
| `npm.cmd run typecheck` | exit 0 |
| `npm.cmd run build` | exit 0，`Build complete` |
| `npm.cmd run test:smoke`（Windows，具备进程管理权限） | 连续两轮通过，每轮 1 个文件、2 个测试通过 |
| smoke 后端口/锁检查 | 43000–44999 无残留监听，`.nuxt/nuxt.lock` 不存在 |
| `git diff --check` | exit 0 |

受限执行环境中曾出现 smoke 清理失败，原因是该环境执行 `taskkill` 返回“拒绝访问”；同一代码在允许管理自身测试子进程的 Windows 环境中连续两轮通过，因此该失败属于验证环境权限差异，不是业务或模块加载失败。

## 4. 规格边界与非阻塞说明

1. 官网 `identity.post` 的用户输入 `customerType` 仍按既有输入契约处理；本次 `customer_type` 枚举修复严格针对 Agent 画像 Provider 输出，未擅自扩大业务决策范围。
2. 构建仍有既有警告：客户端存在超过 500 kB 的 chunk、Node/Nitro 弃用提示、`node:sqlite` 被视为 external，以及未使用的 `Notification` 导入。这些不影响本次构建成功，但建议后续单独治理。
3. smoke 辅助代码会清理测试工作区的 `.nuxt/nuxt.lock`；该测试应在独占的开发工作区运行，避免与同目录下其他 Nuxt 进程并行。

## 5. 提交范围

将提交以下本次修复相关内容：业务代码、共享联系人校验、数据库迁移、Vitest 配置、单元/集成/smoke 测试，以及 `docs/` 下的规格、修复、审核和本最终汇总文档。

明确不提交：

- `CAP_Agent_问题定位报告_2026-07-28.html`：工作区中已有的无关未跟踪文件；
- `.env.example`、`nuxt.config.ts`：仅显示换行归一化状态，无实际内容差异。

## 6. 发布目标

远端：`https://github.com/HHD490/CAP_Agent.git`

目标分支：`codex/AHa-testing`
