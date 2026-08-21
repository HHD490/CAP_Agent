# Coverage Evidence 分析（fresh 跑于 11:28）

生成时间: 2026-08-14T03:30:51.318Z

## 0. 总体 (server + utils + composables 业务代码区)

- stmt:  1592/1633 = 97.49%
- branch: 604/657 = 91.93%（部分覆盖计 1）
- func:  50/50 = 100.00%
- 文件数: 17

## 1. 每个文件 stmt/branch 覆盖

| 文件 | stmt | branch (部分) | func | 未覆盖行 |
|---|---:|---:|---:|---|
| `composables/useDemoState.ts` | 61/91 (67.0%) | 34/39 (87.2%) | 6/6 (100.0%) | 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 81, 82, 83, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 100, 101, 102, 103, 104 |
| `server/api/state.get.ts` | 2/2 (100.0%) | 1/1 (100.0%) | 0/0 (N/A%) | ✓ 无 |
| `server/api/agent/tasks.post.ts` | 12/12 (100.0%) | 1/1 (100.0%) | 0/0 (N/A%) | ✓ 无 |
| `server/api/agent/tasks/[id]/stop.post.ts` | 2/2 (100.0%) | 2/2 (100.0%) | 0/0 (N/A%) | ✓ 无 |
| `server/api/demo/action.post.ts` | 201/201 (100.0%) | 142/152 (93.4%) | 0/0 (N/A%) | ✓ 无 |
| `server/api/demo/advance-time.post.ts` | 35/35 (100.0%) | 12/12 (100.0%) | 0/0 (N/A%) | ✓ 无 |
| `server/api/demo/reset.post.ts` | 6/6 (100.0%) | 1/1 (100.0%) | 0/0 (N/A%) | ✓ 无 |
| `server/api/import/customers.post.ts` | 50/50 (100.0%) | 52/54 (96.3%) | 0/0 (N/A%) | ✓ 无 |
| `server/api/website/identity.post.ts` | 64/64 (100.0%) | 23/26 (88.5%) | 0/0 (N/A%) | ✓ 无 |
| `server/api/website/quote.post.ts` | 41/41 (100.0%) | 11/11 (100.0%) | 0/0 (N/A%) | ✓ 无 |
| `server/api/website/rematch.post.ts` | 38/38 (100.0%) | 5/6 (83.3%) | 0/0 (N/A%) | ✓ 无 |
| `server/utils/agent.ts` | 460/468 (98.3%) | 167/188 (88.8%) | 19/19 (100.0%) | 216, 217, 218, 348, 349, 350, 523, 524 |
| `server/utils/contact.ts` | 5/5 (100.0%) | 8/8 (100.0%) | 1/1 (100.0%) | ✓ 无 |
| `server/utils/db.ts` | 314/317 (99.1%) | 70/75 (93.3%) | 14/14 (100.0%) | 296, 297, 298 |
| `server/utils/state.ts` | 238/238 (100.0%) | 53/55 (96.4%) | 9/9 (100.0%) | ✓ 无 |
| `server/utils/website.ts` | 52/52 (100.0%) | 22/26 (84.6%) | 1/1 (100.0%) | ✓ 无 |
| `utils/opportunity.ts` | 11/11 (100.0%) | 0/0 (NaN%) | 0/0 (N/A%) | ✓ 无 |

## 2. 缺一臂的 branch（真"没测到"的分支）

每个 branch 列出：(文件, 行号, 总臂数, 缺臂, 源码上下文)
（无）

## 3. 死分支 allZero（v8 instrument artifact / 防御性 / 不可达）

这种不是"没测到"，是代码本身在该路径下不可达。列出文件:行号 供对照 test-scope §4 排除项登记。

- **composables/useDemoState.ts**: L80 (1臂全0), L80 (1臂全0), L16 (1臂全0), L35 (1臂全0), L37 (1臂全0)
- **server/api/demo/action.post.ts**: L21 (1臂全0), L22 (1臂全0), L31 (1臂全0), L49 (1臂全0), L49 (1臂全0), L50 (1臂全0), L60 (1臂全0), L79 (1臂全0), L93 (1臂全0), L116 (1臂全0)
- **server/api/import/customers.post.ts**: L18 (1臂全0), L20 (1臂全0)
- **server/api/website/identity.post.ts**: L20 (1臂全0), L27 (1臂全0), L42 (1臂全0)
- **server/api/website/rematch.post.ts**: L31 (1臂全0)
- **server/utils/agent.ts**: L199 (1臂全0), L203 (1臂全0), L205 (1臂全0), L215 (1臂全0), L240 (1臂全0), L241 (1臂全0), L242 (1臂全0), L279 (1臂全0), L280 (1臂全0), L285 (1臂全0), L286 (1臂全0), L287 (1臂全0), L291 (1臂全0), L253 (1臂全0), L254 (1臂全0), L255 (1臂全0), L347 (1臂全0), L351 (1臂全0), L475 (1臂全0), L502 (1臂全0), L522 (1臂全0)
- **server/utils/db.ts**: L193 (1臂全0), L206 (1臂全0), L246 (1臂全0), L246 (1臂全0), L295 (1臂全0)
- **server/utils/state.ts**: L5 (1臂全0), L98 (1臂全0)
- **server/utils/website.ts**: L16 (1臂全0), L17 (1臂全0), L18 (1臂全0), L23 (1臂全0)

## 4. 未覆盖 stmt 行（按文件）含源码上下文


### composables/useDemoState.ts (30 行未覆盖)
- L17-L26:
  L17: `for (const task of next.tasks) {`
  L18: `const before = knownTaskStatus.value[task.id]`
  L19: `if (before && before !== task.status && task.status === 'completed') {`
  L20: `Notification.success({ title: 'Agent 任务已完成', content: task.currentStep || '结果已同步到业务页面', duration: 4500 })`
  L21: `}`
  L22: `if (before && before !== task.status && task.status === 'failed') {`
  L23: `Notification.error({ title: 'Agent 任务失败', content: task.error || '请在 Agent 任务中心查看并重试', duration: 6000 })`
  L24: `}`
  L25: `}`
  L26: `}`
- L81-L83:
  L81: `pollStarted.value = true`
  L82: `window.setInterval(() => {`
  L83: `if (document.visibilityState !== 'visible') return`
- L85-L96:
  L85: `const hasRunningTask = state.value?.tasks.some(task =>`
  L86: `['queued', 'running', 'waiting'].includes(task.status)`
  L87: `)`
  L88: `const activeElement = document.activeElement as HTMLElement | null`
  L89: `const userIsEditing = Boolean(activeElement?.closest(`
  L90: `'input, textarea, [contenteditable="true"], .arco-select-view, .arco-picker'`
  L91: `))`
  L92: `const hasOpenPopup = Array.from(document.querySelectorAll<HTMLElement>('.arco-trigger-popup'))`
  L93: `.some(element => {`
  L94: `const rect = element.getBoundingClientRect()`
  L95: `return rect.width > 0 && rect.height > 0`
  L96: `})`
- L100-L104:
  L100: `if (hasRunningTask && !userIsEditing && !hasOpenPopup) {`
  L101: `void refresh({ quiet: true }).catch(() => undefined)`
  L102: `}`
  L103: `}, 1500)`
  L104: `}`

### server/utils/agent.ts (8 行未覆盖)
- L216-L218:
  L216: `: Array.isArray(content)`
  L217: `? content.map((part: any) => typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '').join('')`
  L218: `: JSON.stringify(content) || ''`
- L348-L350:
  L348: `prompt_tokens: response.usage.prompt_tokens,`
  L349: `completion_tokens: response.usage.completion_tokens,`
  L350: `total_tokens: response.usage.total_tokens`
- L523-L524:
  L523: `setTimeout(() => { void runTask(id, config) }, 40)`
  L524: `}`

### server/utils/db.ts (3 行未覆盖)
- L296-L298:
  L296: `db.exec('ROLLBACK')`
  L297: `throw error`
  L298: `}`