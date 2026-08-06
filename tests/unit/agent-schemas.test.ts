import { describe, expect, it } from 'vitest'
import { getAgentSchemas } from '../../server/utils/agent'

/**
 * Agent 5 个模式 schema 的契约测试。
 *
 * 重点覆盖：
 * - confidence 接受中文/英文别名和数字（>=0.8 → high, >=0.55 → medium, 否则 low）
 * - outreach_drafting 接受 language 别名 (en/english/英文 → en, 其余 → zh)
 * - handoff_summary 的 recommended_product 接受 {code,name} 或非空字符串，并做 transform
 * - 各模式 required 字段缺失时必须抛错
 *
 * 这是 agent-nondeterministic-evaluator skill 的"准入"前置：schema 不通过，
 * 任何 Prompt / 模型 / 工具变更的离线评测都没有意义。
 */
describe('AGENT-SCHEMAS: 5 个 Agent 模式的 schema 契约', () => {
  const schemas = getAgentSchemas()

  describe('confidence 归一化', () => {
    const cases: Array<[unknown, 'low' | 'medium' | 'high']> = [
      ['high', 'high'],
      ['HIGH', 'high'],
      ['高', 'high'],
      ['高置信度', 'high'],
      [1, 'high'],
      [0.95, 'high'],
      [0.8, 'high'],
      ['medium', 'medium'],
      ['Medium', 'medium'],
      ['中', 'medium'],
      ['中等', 'medium'],
      [0.7, 'medium'],
      [0.55, 'medium'],
      ['low', 'low'],
      ['低', 'low'],
      ['低置信度', 'low'],
      [0.5, 'low'],
      [0, 'low']
    ]

    for (const [input, expected] of cases) {
      it(`AGENT-SCHEMAS-CONF-${String(input).replace(/[^a-z0-9]/gi, '_')}: ${JSON.stringify(input)} → ${expected}`, () => {
        const result = (schemas.product_matching.shape.matches as any).element.shape.confidence.parse(input)
        expect(result).toBe(expected)
      })
    }

    // 注：当前 schema 把"非空字符串"和"任意数字"都归一化为 high/medium/low，
    // 数字边界（>1 / <0）也被吞掉。锁定当前行为，避免回归；如要拒绝非法值
    // 需扩展 z.preprocess 返回 ZodIssue，再单独写一个 PR。
    const recognized: Array<[unknown, 'low' | 'medium' | 'high']> = [
      [1.5, 'high'],
      [-0.1, 'low'],
      [Number.NaN, 'low']
    ]
    for (const [input, expected] of recognized) {
      it(`AGENT-SCHEMAS-CONF-NUMERIC-${String(input)}: 数字 ${String(input)} → ${expected}`, () => {
        const schema = (schemas.product_matching.shape.matches as any).element.shape.confidence
        const result = schema.parse(input)
        expect(result).toBe(expected)
      })
    }

    const rejected: unknown[] = ['', '超高', 'very_high', {}, []]
    for (const bad of rejected) {
      it(`AGENT-SCHEMAS-CONF-INVALID-${JSON.stringify(bad) || 'empty'}: 未知字符串/对象/数组必须被拒绝`, () => {
        const schema = (schemas.product_matching.shape.matches as any).element.shape.confidence
        expect(() => schema.parse(bad)).toThrow()
      })
    }
  })

  describe('outreach_drafting.language 别名归一', () => {
    it('AGENT-SCHEMAS-LANG-001: zh / 中文 / 其它非 en 别名 → zh', () => {
      for (const v of ['zh', '中文', 'ZH', 'CN', '中文邮件', '']) {
        expect(schemas.outreach_drafting.shape.language.parse(v)).toBe('zh')
      }
    })

    it('AGENT-SCHEMAS-LANG-002: en / English / english / 英文 → en', () => {
      for (const v of ['en', 'English', 'english', '英文']) {
        expect(schemas.outreach_drafting.shape.language.parse(v)).toBe('en')
      }
    })

    it('AGENT-SCHEMAS-LANG-002b: "en-US" / "EN_US" 等带分隔符的别名当前被归一为 zh（行为锁定）', () => {
      // 已知行为：preprocess 用精确匹配 + toLowerCase，不拆分隔符
      expect(schemas.outreach_drafting.shape.language.parse('en-US')).toBe('zh')
      expect(schemas.outreach_drafting.shape.language.parse('EN_us')).toBe('zh')
    })

    it('AGENT-SCHEMAS-LANG-003: 缺省时默认 zh', () => {
      expect(schemas.outreach_drafting.shape.language.parse(undefined)).toBe('zh')
    })

    it('AGENT-SCHEMAS-LANG-004: 锁定数字/对象被吞掉为 zh 的当前行为（需扩展 schema 才抛错）', () => {
      // 已知行为：String(123 || '') = '123'，被 preprocess 归类为 zh。
      // 这是潜在风险：调用方传错类型不会报错。锁定以防回归。
      expect(schemas.outreach_drafting.shape.language.parse(123)).toBe('zh')
      expect(schemas.outreach_drafting.shape.language.parse({ lang: 'en' } as any)).toBe('zh')
    })
  })

  describe('reply_qualification.intent 取值约束', () => {
    it.each(['explicit', 'ambiguous', 'not_interested', 'auto_reply'])(
      'AGENT-SCHEMAS-INTENT-%s: 合法 intent 通过',
      (intent) => {
        const result = schemas.reply_qualification.shape.intent.parse(intent)
        expect(result).toBe(intent)
      }
    )

    it('AGENT-SCHEMAS-INTENT-INVALID: 非法 intent 抛错', () => {
      expect(() => schemas.reply_qualification.shape.intent.parse('maybe')).toThrow()
      expect(() => schemas.reply_qualification.shape.intent.parse('')).toThrow()
      expect(() => schemas.reply_qualification.shape.intent.parse(null)).toThrow()
    })
  })

  describe('recommended_product 契约（handoff_summary）', () => {
    it('AGENT-SCHEMAS-PROD-001: provider_object → source=provider_object + 原 code/name', () => {
      const result = schemas.handoff_summary.shape.recommended_product.parse({
        product_code: 'BY002',
        product_name: '美东大客户空派专线'
      })
      expect(result).toEqual({
        product_code: 'BY002',
        product_name: '美东大客户空派专线',
        source: 'provider_object'
      })
    })

    it('AGENT-SCHEMAS-PROD-002: 非空字符串 → product_code=null + source=legacy_string', () => {
      const result = schemas.handoff_summary.shape.recommended_product.parse('美东大客户空派专线')
      expect(result).toEqual({
        product_code: null,
        product_name: '美东大客户空派专线',
        source: 'legacy_string'
      })
    })

    const invalids: unknown[] = ['', {}, { product_code: 'BY002' }, { product_name: 'x' }, { product_code: '', product_name: '' }, { product_code: 'BY002', product_name: '' }]
    for (const bad of invalids) {
      it(`AGENT-SCHEMAS-PROD-INVALID-${JSON.stringify(bad) || 'null'}: 非法值必须被拒绝`, () => {
        expect(() => schemas.handoff_summary.shape.recommended_product.parse(bad)).toThrow()
      })
    }
  })

  describe('customer_profiling 必填字段', () => {
    const base = {
      customer_type: 'trading_company',
      summary: '测试摘要',
      likely_needs: ['中国出口运力'],
      capabilities: ['清关'],
      target_lanes: ['中国-美国'],
      confidence: 'high',
      evidence: ['公司服务范围'],
      suggested_next_action: '进入产品匹配'
    }

    it('AGENT-SCHEMAS-PROFILE-001: 完整 payload 通过', () => {
      expect(() => schemas.customer_profiling.parse(base)).not.toThrow()
    })

    it.each([
      'customer_type',
      'summary',
      'evidence',
      'suggested_next_action'
    ])('AGENT-SCHEMAS-PROFILE-002-%s: 缺 %s 必须抛错', (field) => {
      const bad: any = { ...base }
      delete bad[field]
      expect(() => schemas.customer_profiling.parse(bad)).toThrow()
    })

    it('AGENT-SCHEMAS-PROFILE-003: evidence 为空数组必须抛错', () => {
      expect(() => schemas.customer_profiling.parse({ ...base, evidence: [] })).toThrow()
    })

    it('AGENT-SCHEMAS-PROFILE-004: 不在枚举内的 customer_type 必须抛错', () => {
      expect(() => schemas.customer_profiling.parse({ ...base, customer_type: 'unknown_v2' })).toThrow()
      expect(() => schemas.customer_profiling.parse({ ...base, customer_type: 'HIGH_VALUE_PARTNER' })).toThrow()
    })

    it('AGENT-SCHEMAS-PROFILE-005: 默认值字段缺失时使用空数组默认值', () => {
      const minimal = { ...base }
      delete (minimal as any).likely_needs
      delete (minimal as any).capabilities
      delete (minimal as any).target_lanes
      delete (minimal as any).missing_information
      const parsed = schemas.customer_profiling.parse(minimal) as any
      expect(parsed.likely_needs).toEqual([])
      expect(parsed.capabilities).toEqual([])
      expect(parsed.target_lanes).toEqual([])
      expect(parsed.missing_information).toEqual([])
    })
  })

  describe('product_matching 必填与边界', () => {
    const base = {
      matches: [{
        product_code: 'BY001',
        fit_score: 88,
        confidence: 'high',
        evidence: ['美国方向'],
        risks: [],
        missing_information: [],
        hard_blockers: []
      }]
    }

    it('AGENT-SCHEMAS-MATCH-001: 完整 match payload 通过', () => {
      expect(() => schemas.product_matching.parse(base)).not.toThrow()
    })

    it('AGENT-SCHEMAS-MATCH-002: matches 为空数组抛错', () => {
      expect(() => schemas.product_matching.parse({ matches: [] })).toThrow()
    })

    it('AGENT-SCHEMAS-MATCH-003: matches 超过 3 个抛错（业务上限）', () => {
      const four = {
        matches: [
          { ...base.matches[0] },
          { ...base.matches[0] },
          { ...base.matches[0] },
          { ...base.matches[0] }
        ]
      }
      expect(() => schemas.product_matching.parse(four)).toThrow()
    })

    it('AGENT-SCHEMAS-MATCH-004: fit_score 越界（>100 / <0）抛错', () => {
      expect(() => schemas.product_matching.parse({ matches: [{ ...base.matches[0], fit_score: 101 }] })).toThrow()
      expect(() => schemas.product_matching.parse({ matches: [{ ...base.matches[0], fit_score: -1 }] })).toThrow()
    })

    it('AGENT-SCHEMAS-MATCH-005: fit_score 接受字符串数字 (coerce)', () => {
      expect(() => schemas.product_matching.parse({ matches: [{ ...base.matches[0], fit_score: '85' as any }] })).not.toThrow()
    })

    it('AGENT-SCHEMAS-MATCH-006: evidence 为空数组抛错（每条 match 必须有可核验依据）', () => {
      expect(() => schemas.product_matching.parse({ matches: [{ ...base.matches[0], evidence: [] }] })).toThrow()
    })
  })

  describe('outreach_drafting 必填', () => {
    const base = {
      language: 'zh',
      subject: '关于合作',
      body: '您好……',
      evidence: ['匹配产品 BY001'],
      call_to_action: '请回复时间'
    }

    it('AGENT-SCHEMAS-DRAFT-001: 完整 draft 通过', () => {
      expect(() => schemas.outreach_drafting.parse(base)).not.toThrow()
    })

    it('AGENT-SCHEMAS-DRAFT-002: subject / body / call_to_action 字段缺失抛错', () => {
      // z.string() 默认允许空串；如果要拒绝空串必须 .min(1)。
      // 锁定当前行为：字段缺失才抛错，空串不抛。
      const { subject, ...rest } = base
      expect(() => schemas.outreach_drafting.parse(rest)).toThrow()
      const { body, ...rest2 } = base
      expect(() => schemas.outreach_drafting.parse(rest2)).toThrow()
      const { call_to_action, ...rest3 } = base
      expect(() => schemas.outreach_drafting.parse(rest3)).toThrow()
    })

    it('AGENT-SCHEMAS-DRAFT-002b: subject="" / body="" / call_to_action="" 当前不抛（行为锁定）', () => {
      // 已知：空串当前可落库。如果业务要禁止，需要改 z.string().min(1) 后再解锁。
      expect(() => schemas.outreach_drafting.parse({ ...base, subject: '' })).not.toThrow()
      expect(() => schemas.outreach_drafting.parse({ ...base, body: '' })).not.toThrow()
      expect(() => schemas.outreach_drafting.parse({ ...base, call_to_action: '' })).not.toThrow()
    })

    it('AGENT-SCHEMAS-DRAFT-003: evidence 缺失抛错', () => {
      expect(() => schemas.outreach_drafting.parse({ ...base, evidence: [] })).toThrow()
    })
  })

  describe('handoff_summary 必填', () => {
    const base = {
      summary: '可分配负责人',
      customer_need: '美东空派',
      recommended_product: { product_code: 'BY002', product_name: '美东大客户空派专线' },
      evidence: ['客户要求'],
      risks: ['价格敏感'],
      next_steps: ['分配负责人']
    }

    it('AGENT-SCHEMAS-HANDOFF-001: 完整 handoff 通过', () => {
      expect(() => schemas.handoff_summary.parse(base)).not.toThrow()
    })

    it('AGENT-SCHEMAS-HANDOFF-002: next_steps 为空抛错', () => {
      expect(() => schemas.handoff_summary.parse({ ...base, next_steps: [] })).toThrow()
    })

    it('AGENT-SCHEMAS-HANDOFF-003: risks 缺省时默认为空数组', () => {
      const { risks, ...rest } = base
      const parsed = schemas.handoff_summary.parse(rest) as any
      expect(parsed.risks).toEqual([])
    })
  })

  describe('customer_profiling customer_type 6 枚举全量通过', () => {
    // 与 profile-type.test.ts PROFILE-TYPE-001 的"全量落库"互补：
    // 本组只测 schema 层的纯函数合同，不依赖 DB / runAgentTaskNow
    const allTypes = [
      'freight_forwarder_partner',
      'ecommerce_seller',
      'exporter',
      'trading_company',
      'direct_shipper',
      'unknown'
    ] as const

    for (const t of allTypes) {
      it(`AGENT-SCHEMAS-PROFILE-ENUM-${t}: ${t} 通过 schema 校验`, () => {
        const payload = {
          customer_type: t,
          summary: '枚举测试',
          likely_needs: [],
          capabilities: [],
          target_lanes: [],
          confidence: 'high',
          evidence: ['单测'],
          missing_information: [],
          suggested_next_action: 'noop'
        }
        const parsed = schemas.customer_profiling.parse(payload) as any
        expect(parsed.customer_type).toBe(t)
      })
    }

    it('AGENT-SCHEMAS-PROFILE-ENUM-COUNT: 6 个枚举值与 getAgentCustomerTypes() 同步', async () => {
      const { getAgentCustomerTypes } = await import('../../server/utils/agent')
      expect(getAgentCustomerTypes()).toEqual(allTypes)
    })

    it('AGENT-SCHEMAS-PROFILE-ENUM-MATRIX: 6 类型 × 3 置信度 全部合法组合通过', () => {
      const confidences = ['low', 'medium', 'high'] as const
      for (const t of allTypes) {
        for (const c of confidences) {
          const payload = {
            customer_type: t,
            summary: 'matrix',
            likely_needs: [],
            capabilities: [],
            target_lanes: [],
            confidence: c,
            evidence: ['m'],
            suggested_next_action: 'noop'
          }
          const parsed = schemas.customer_profiling.parse(payload) as any
          expect(parsed.customer_type).toBe(t)
          expect(parsed.confidence).toBe(c)
        }
      }
    })
  })

  describe('product_matching fit_score 边界（强 schema 合同）', () => {
    const base = {
      matches: [{
        product_code: 'BY001',
        fit_score: 0,
        confidence: 'high' as const,
        evidence: ['e'],
        risks: [],
        missing_information: [],
        hard_blockers: []
      }]
    }

    it('AGENT-SCHEMAS-MATCH-007: fit_score=0 / 100 边界合法', () => {
      expect(() => schemas.product_matching.parse({ matches: [{ ...base.matches[0], fit_score: 0 }] })).not.toThrow()
      expect(() => schemas.product_matching.parse({ matches: [{ ...base.matches[0], fit_score: 100 }] })).not.toThrow()
    })

    it('AGENT-SCHEMAS-MATCH-008: fit_score 接受数字字符串 ("85") 而非数字 → coerce 走通', () => {
      const parsed = schemas.product_matching.parse({ matches: [{ ...base.matches[0], fit_score: '85' as any }] }) as any
      expect(parsed.matches[0].fit_score).toBe(85)
    })

    it('AGENT-SCHEMAS-MATCH-009: fit_score 接受浮点 ("85.7") → coerce 后是 85.7', () => {
      const parsed = schemas.product_matching.parse({ matches: [{ ...base.matches[0], fit_score: '85.7' as any }] }) as any
      expect(parsed.matches[0].fit_score).toBe(85.7)
    })

    it('AGENT-SCHEMAS-MATCH-010: fit_score 非法字符串 ("abc") 抛错（coerce 不放过非数字）', () => {
      expect(() => schemas.product_matching.parse({ matches: [{ ...base.matches[0], fit_score: 'abc' as any }] })).toThrow()
    })

    it('AGENT-SCHEMAS-MATCH-011: matches=3 上限合法', () => {
      const three = { matches: [
        { ...base.matches[0] },
        { ...base.matches[0] },
        { ...base.matches[0] }
      ] }
      expect(() => schemas.product_matching.parse(three)).not.toThrow()
    })

    it('AGENT-SCHEMAS-MATCH-012: 3 条 matches 时 product_code 不必唯一（不同产品可同分）', () => {
      const three = { matches: [
        { ...base.matches[0], product_code: 'BY001' },
        { ...base.matches[0], product_code: 'BY002' },
        { ...base.matches[0], product_code: 'BY003' }
      ] }
      const parsed = schemas.product_matching.parse(three) as any
      expect(parsed.matches.map((m: any) => m.product_code)).toEqual(['BY001', 'BY002', 'BY003'])
    })
  })

  describe('outreach_drafting 默认值与边界', () => {
    const base = {
      language: 'zh' as const,
      subject: '主题',
      body: '正文',
      evidence: ['e'],
      call_to_action: 'CTA'
    }

    it('AGENT-SCHEMAS-DRAFT-004: 缺 language 时默认 zh（preprocess 走 else 分支）', () => {
      const { language: _lang, ...rest } = base
      const parsed = schemas.outreach_drafting.parse(rest) as any
      expect(parsed.language).toBe('zh')
    })

    it('AGENT-SCHEMAS-DRAFT-005: language=null / 0 走 default 路径（preprocess 判定 falsy → "null"/"0" → zh）', () => {
      // 行为锁定：非字符串类型在 preprocess 阶段被 String() 强制转换
      expect(schemas.outreach_drafting.shape.language.parse(null as any)).toBe('zh')
      expect(schemas.outreach_drafting.shape.language.parse(0 as any)).toBe('zh')
    })

    it('AGENT-SCHEMAS-DRAFT-006: evidence 缺省时默认 []（违反 .min(1) 必被 schema 拒绝）', () => {
      const { evidence: _e, ...rest } = base
      expect(() => schemas.outreach_drafting.parse(rest)).toThrow()
    })

    it('AGENT-SCHEMAS-DRAFT-007: subject / body 接受非空任意字符串（含中文 / emoji / 换行）', () => {
      const payload = { ...base, subject: '合作🇨🇳', body: '第一行\n第二行' }
      const parsed = schemas.outreach_drafting.parse(payload) as any
      expect(parsed.subject).toBe('合作🇨🇳')
      expect(parsed.body).toBe('第一行\n第二行')
    })
  })

  describe('reply_qualification 必填 + intent 阻断文本', () => {
    const base = {
      intent: 'explicit' as const,
      confidence: 'high' as const,
      evidence: ['客户明确要求报价'],
      summary: '明确意向',
      next_action: '分配负责人'
    }

    it('AGENT-SCHEMAS-REPLY-001: 4 个合法 intent 全部通过', () => {
      for (const intent of ['explicit', 'ambiguous', 'not_interested', 'auto_reply'] as const) {
        const parsed = schemas.reply_qualification.parse({ ...base, intent }) as any
        expect(parsed.intent).toBe(intent)
      }
    })

    it('AGENT-SCHEMAS-REPLY-002: intent 缺省抛错', () => {
      const { intent: _i, ...rest } = base
      expect(() => schemas.reply_qualification.parse(rest)).toThrow()
    })

    it('AGENT-SCHEMAS-REPLY-003: confidence 与 intent 独立校验（任意 intent 配 3 档 confidence 都通过）', () => {
      const intents = ['explicit', 'ambiguous', 'not_interested', 'auto_reply'] as const
      const confidences = ['low', 'medium', 'high'] as const
      for (const intent of intents) {
        for (const confidence of confidences) {
          const parsed = schemas.reply_qualification.parse({ ...base, intent, confidence }) as any
          expect(parsed.intent).toBe(intent)
          expect(parsed.confidence).toBe(confidence)
        }
      }
    })

    it('AGENT-SCHEMAS-REPLY-004: 缺 evidence 抛错（每条判断必须可核验）', () => {
      const { evidence: _e, ...rest } = base
      expect(() => schemas.reply_qualification.parse(rest)).toThrow()
    })
  })
})
