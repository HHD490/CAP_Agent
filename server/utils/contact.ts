/** Shared “有效建联联系人”规则 — Agent 与 demo/action 必须一致。 */
export function isValidOutreachContact(contact: { status?: string | null, email?: string | null } | null | undefined): boolean {
  if (!contact) return false
  if (contact.status !== 'contactable') return false
  return String(contact.email || '').trim().length > 0
}
