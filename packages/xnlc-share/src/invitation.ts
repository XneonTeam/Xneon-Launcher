import { ShareError } from "./types.js"

/** Коды допускают другой регистр и пробелы при вводе; старые приглашения сохраняют регистр. */
export function parseInvitation(value: string): string {
  const token = value.trim()
  const code = token.replace(/\s/g, "").toUpperCase()
  if (code.startsWith("XNLC-")) {
    if (!/^XNLC-(?:[A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/.test(code)) throw new ShareError("INVITE", "Invalid invitation code")
    return code
  }
  if (!/^[A-Za-z0-9_-]{20,160}$/.test(token)) throw new ShareError("INVITE", "Invalid invitation")
  return token
}
