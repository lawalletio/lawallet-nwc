/**
 * Shared lightning-address format utilities.
 *
 * The regex mirrors LUD-16's "internet identifier" grammar (RFC 5321 local
 * part, plus dots/plusses/etc., at an RFC-1035 host with a 2+ char TLD).
 * Used by both client-side form validation (edit page, forwarding card)
 * and by the server-side Zod schema in `lib/validation/schemas.ts` so the
 * same characters accepted by the UI are accepted by the API.
 */
export const LN_ADDRESS_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i

/** Returns true when `value` looks like a LUD-16 "user@host" address. */
export function isLightningAddress(value: string): boolean {
  return LN_ADDRESS_RE.test(value)
}
