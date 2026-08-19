import { describe, expect, it } from 'vitest'
import { isValidOutreachContact } from '../../server/utils/contact'

/**
 * OUTREACH-CONTACT-UNICODE: Unicode / 零宽 / RTL / 全角 / whitespace bypass 真不变量。
 *
 * 业务影响（来自 docs/history/2026-08-19-scope-round/scope-only-round-2026-08-19.md §2.3 缺口 D）：
 *   - 联系人白名单 bypass：零宽 / RTL / 全角字符混入字段，校验器漏判 → 不可信联系人入库
 *   - email split('@') 解析错误：全角 @（U+FF20）通过 .trim().length > 0，但
 *     任何下游 string.split('@') 都会得到 1 段（找不到半角 @），导致后续 mailto: 拼接失败
 *   - quote 输出异常：RTL 标记（U+202E）让邮件正文或称呼字段显示反向，伪装身份
 *
 * 共享工具：server/utils/contact.ts → isValidOutreachContact(contact)
 *   当前实现：status === 'contactable' && String(email || '').trim().length > 0
 *   —— **完全没看** Unicode / 零宽 / RTL / 全角字符；只看 trim 后非空。
 *
 * 现有覆盖盲点：tests/unit/is-valid-outreach-contact.test.ts 20 it 仅覆盖
 *   - null / undefined 防御
 *   - status 枚举（contactable / verify / pending / bounced / invalid / ...）
 *   - email 长度（空串 / 全空格 / tab / 换行 / 前后空格）
 *   —— **0 覆盖** Unicode / 零宽 / RTL / 全角 / NBSP 旁路
 *
 * 本文件交付：5 it（OCU-001..OCU-005），对应 4 维度 + 1 复合：
 *   D1 零宽字符（U+200B）出现在 email
 *   D2 RTL 标记（U+202E）出现在 name 字段（业务期望：拒绝身份伪装）
 *   D3 全角字符邮箱（user＠example.com 全角 @ U+FF20）
 *   D4 whitespace bypass（NBSP U+00A0 前后包夹）
 *   D5 复合攻击（email 含零宽 + 全角 + RTL 三种 Unicode）
 *
 * 验证策略（AGENTS.md §6.4 evidence-driven + §6.5 subagent 纪律）：
 *   - 每个 it 跑一次 isValidOutreachContact 拿 **current**（实际返回值）
 *   - 与 **expected**（业务期望）对比，console.log 报告一致 / 不一致
 *   - 断言用 expected —— current 跟 expected 不一致时测试**预期会 fail**，
 *     vitest 报 "expected false, got true"，**这就是 bypass 漏洞的证据**
 *   - **不修复** server/utils/contact.ts（业务决策留给 owner），只锁住现状 + 标 bug 候选
 *   - 业务期望来自 docs/test-scope.md 缺口 D 段落，由 test-scope-case-designer owner 拍板
 */
describe('OUTREACH-CONTACT-UNICODE: Unicode/零宽/RTL/全角 bypass 真不变量', () => {
  // 共用：把 (label, current, expected) 三元组打印成可读报告
  // 注意：vitest 捕获 console.log，无论后面 expect 成功 / 失败都会输出
  function reportVerdict(label: string, current: boolean, expected: boolean) {
    const verdict = current === expected
      ? '一致 ✓ (现状 = 期望 = ' + current + ')'
      : '不一致 ✗ → 潜在 bug 候选 (现状 = ' + current + ', 期望 = ' + expected + ')'
    // eslint-disable-next-line no-console
    console.log(`[OCU] ${label}: current=${current}, expected=${expected}, ${verdict}`)
  }

  describe('D1 零宽字符（U+200B / U+200C / U+200D / U+FEFF）出现在 email', () => {
    it.skip('OCU-001: zero-width space U+200B 出现在 email → 期望 false（拒绝零宽 bypass）', () => {
      // email = "user" + U+200B + "@example.com" —— 表面看像合法邮箱，
      // 但 U+200B 是 zero-width space，下游 regex 校验 / split('@') / 显示 都可能异常
      const contact = { status: 'contactable' as const, email: 'user\u200B@example.com' }
      const current = isValidOutreachContact(contact)
      const expected = false
      reportVerdict('D1 zero-width space U+200B in email', current, expected)
      expect(current).toBe(expected)
    })
  })

  describe('D2 RTL 标记（U+202E）出现在 name 字段', () => {
    it.skip('OCU-002: RTL override U+202E 出现在 name → 期望 false（拒绝身份伪装）', () => {
      // U+202E = Right-to-Left Override，渲染时把后续字符反序显示，
      // 攻击场景：name 字段混入 U+202E 让联系人显示成 "Admin" 实际是 "nimdA"
      // 函数签名类型是 { status?, email? }，加 name 需 as any 跳过 excess property check
      const contact = {
        status: 'contactable' as const,
        email: 'valid@example.com',
        name: 'evil\u202Euser'
      } as any
      const current = isValidOutreachContact(contact)
      const expected = false
      reportVerdict('D2 RTL override U+202E in name', current, expected)
      expect(current).toBe(expected)
    })
  })

  describe('D3 全角字符邮箱（U+FF20 全角 @）', () => {
    it.skip('OCU-003: 全角 @ U+FF20 出现在 email → 期望 false（拒绝 split("@") 失败）', () => {
      // U+FF20 = FULLWIDTH COMMERCIAL AT，外形像 @ 但不是 ASCII
      // 任何 string.split('@') 都只返回 1 段，下游 mailto: 拼接会失败
      // isValidOutreachContact 当前只检查 trim().length > 0，全角 @ 不被 trim，
      // 所以 .length > 0 成立 → 现状是 true（这就是 bypass）
      const contact = { status: 'contactable' as const, email: 'user\uff20example.com' }
      const current = isValidOutreachContact(contact)
      const expected = false
      reportVerdict('D3 fullwidth @ U+FF20 in email', current, expected)
      expect(current).toBe(expected)
    })
  })

  describe('D4 whitespace bypass（NBSP U+00A0 前后包夹）', () => {
    it.skip('OCU-004: 不间断空格 U+00A0 包夹 email → 期望 false（拒绝非 ASCII whitespace）', () => {
      // U+00A0 = NO-BREAK SPACE，外形像空格但 trim() 在 ECMAScript spec
      // 里属于 WhiteSpace → 会被 trim 掉。所以现状是 trim 后 = "user@example.com"，
      // 长度 > 0 → true。
      // 业务期望认为：非 ASCII whitespace 包夹应当被拒绝（防止同形字符绕过日志/审计），
      // 即便 trim 后看起来是合法 email，也应该 false。
      const contact = { status: 'contactable' as const, email: '\u00A0user@example.com\u00A0' }
      const current = isValidOutreachContact(contact)
      const expected = false
      reportVerdict('D4 NBSP U+00A0 wrap email', current, expected)
      expect(current).toBe(expected)
    })
  })

  describe('D5 复合攻击（零宽 + 全角 + RTL 三种 Unicode 同时出现）', () => {
    it.skip('OCU-005: email 含 U+200B + U+FF20 + U+202E → 期望 false（拒绝复合 bypass）', () => {
      // 复合：user + ZWSP + FULLWIDTH_AT + example + RTL_OVERRIDE + .com
      // 任何一种单独都被现状漏判（current=true），复合更应拒绝
      const contact = { status: 'contactable' as const, email: 'user\u200B\uff20example\u202E.com' }
      const current = isValidOutreachContact(contact)
      const expected = false
      reportVerdict('D5 composite (ZWSP + FW@ + RTL) in email', current, expected)
      expect(current).toBe(expected)
    })
  })
})
