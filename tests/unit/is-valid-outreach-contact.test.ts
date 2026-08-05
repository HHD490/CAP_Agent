import { describe, expect, it } from 'vitest'
import { isValidOutreachContact } from '../../server/utils/contact'

/**
 * server/utils/contact.ts → isValidOutreachContact 纯函数合同。
 *
 * 这是 Agent 与 demo/action.post 共用的"有效建联联系人"判定规则，
 * 一旦规则改变会影响：
 *  - server/api/demo/action.post.ts: accept_match / set_contact
 *  - server/utils/agent.ts: outreach_drafting 模式
 *  - composables/useDemoState.ts: 前端 UI 行为
 *
 * 已有覆盖：tests/integration/demo-action-stale.test.ts 的 CONTACT-VALID-001
 * 本文件提供聚焦单测，把"纯函数合同"与"集成副作用"解耦，定位回归时更直接。
 */
describe('IS-VALID-OUTREACH-CONTACT: 纯函数合同', () => {
  describe('null / undefined 防御', () => {
    it('IVOC-001: null → false', () => {
      expect(isValidOutreachContact(null)).toBe(false)
    })

    it('IVOC-002: undefined → false', () => {
      expect(isValidOutreachContact(undefined)).toBe(false)
    })

    it('IVOC-003: 空对象（所有字段 undefined）→ false', () => {
      // status 缺失等价于 !== 'contactable' → false
      expect(isValidOutreachContact({})).toBe(false)
    })
  })

  describe('status 判定', () => {
    it('IVOC-010: contactable + 合法 email → true', () => {
      expect(isValidOutreachContact({ status: 'contactable', email: 'ok@example.com' })).toBe(true)
    })

    it.each(['verify', 'pending', 'bounced', 'invalid', 'unknown', 'archived', ''])(
      'IVOC-011: 非 contactable 状态（%s）即使 email 合法也 → false',
      (status) => {
        expect(isValidOutreachContact({ status, email: 'ok@example.com' })).toBe(false)
      }
    )

    it('IVOC-012: status 大小写敏感：Contactable → false（必须严格小写）', () => {
      // 防御性：若上游 schema 漂移出 'Contactable'，这里必须拒绝，
      // 避免建联进入"看似可联系但下游逻辑不识别"的状态。
      expect(isValidOutreachContact({ status: 'Contactable', email: 'ok@example.com' })).toBe(false)
      expect(isValidOutreachContact({ status: 'CONTACTABLE', email: 'ok@example.com' })).toBe(false)
    })

    it('IVOC-013: status 为 null / undefined → false（即使 email 合法）', () => {
      expect(isValidOutreachContact({ status: null, email: 'ok@example.com' })).toBe(false)
      expect(isValidOutreachContact({ status: undefined, email: 'ok@example.com' })).toBe(false)
    })
  })

  describe('email 判定（contactable 状态下）', () => {
    it('IVOC-020: contactable + 空串 → false', () => {
      expect(isValidOutreachContact({ status: 'contactable', email: '' })).toBe(false)
    })

    it('IVOC-021: contactable + 全空格 → false（trim 防御）', () => {
      expect(isValidOutreachContact({ status: 'contactable', email: '   ' })).toBe(false)
    })

    it('IVOC-022: contactable + tab / 换行 → false（whitespace 集合防御）', () => {
      expect(isValidOutreachContact({ status: 'contactable', email: '\t' })).toBe(false)
      expect(isValidOutreachContact({ status: 'contactable', email: '\n\n' })).toBe(false)
      expect(isValidOutreachContact({ status: 'contactable', email: ' \t \n ' })).toBe(false)
    })

    it('IVOC-023: contactable + null email → false', () => {
      expect(isValidOutreachContact({ status: 'contactable', email: null })).toBe(false)
    })

    it('IVOC-024: contactable + undefined email → false', () => {
      expect(isValidOutreachContact({ status: 'contactable', email: undefined })).toBe(false)
    })

    it('IVOC-025: contactable + 前后空格 + 真实 email → true（trim 不影响真实值）', () => {
      expect(isValidOutreachContact({ status: 'contactable', email: '  ok@example.com  ' })).toBe(true)
    })
  })

  describe('组合回归（status 与 email 各自把关）', () => {
    it('IVOC-030: 短真值表（status, email）→ 期望结果', () => {
      // 纯函数等价类压缩：枚举所有 (status 合法, email 合法) 组合
      const cases: Array<[string | null | undefined, string | null | undefined, boolean]> = [
        ['contactable', 'a@b.com', true],
        ['contactable', '', false],
        ['contactable', '   ', false],
        ['contactable', null, false],
        ['contactable', undefined, false],
        ['verify', 'a@b.com', false],
        ['pending', '', false],
        [null, 'a@b.com', false],
        [undefined, undefined, false]
      ]
      for (const [status, email, expected] of cases) {
        expect(isValidOutreachContact({ status, email })).toBe(expected)
      }
    })
  })
})
