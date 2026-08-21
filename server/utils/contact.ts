/** Shared “有效建联联系人”规则 — Agent 与 demo/action 必须一致。 */
export function isValidOutreachContact(contact: { status?: string | null, email?: string | null, name?: string | null } | null | undefined): boolean {
  if (!contact) return false
  if (contact.status !== 'contactable') return false
  const rawEmail = String(contact.email || '')
  // Unicode guard: 拒绝零宽 / RTL / 全角 / NBSP 等 bypass 字符
  // 必须在 trim() 之前检查（ECMAScript trim 会移除 NBSP / 零宽等 Whitespace），
  // 否则 "\u00A0user@example.com\u00A0" 会被 trim 成合法 email 漏判
  if (UNICODE_BLACKLIST.test(rawEmail)) return false
  const email = rawEmail.trim()
  if (!email) return false
  if (contact.name && UNICODE_BLACKLIST.test(contact.name)) return false
  return true
}

/**
 * 拒绝以下 Unicode 字符（防止身份伪装 / email 解析失败 / RTL 反向显示）：
 *   \u200B-\u200D  零宽空格 / ZWNJ / ZWJ
 *   \uFEFF        零宽不换行空格 (BOM)
 *   \u202A-\u202E  Bidi 控制字符 (LRE/RLE/PDF/LRO/RLO)
 *   \u2066-\u2069  Bidi isolate 控制 (LRI/RLI/FSI/PDI)
 *   \uFF20        全角 @
 *   \u00A0        不间断空格 (NBSP)
 *
 * 参考 docs/history/2026-08-19-scope-round/scope-only-round-2026-08-19.md §2.3 缺口 D。
 */
const UNICODE_BLACKLIST = /[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069\uff20\u00A0]/
