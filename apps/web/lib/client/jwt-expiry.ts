/** How long before `exp` we treat a session JWT as due for a silent remint. */
export const SESSION_REFRESH_BUFFER_MS = 5 * 60 * 1000

/**
 * Decodes a JWT payload without verifying the signature. Opaque / malformed
 * tokens return `null`. Only for deciding what the client renders — the
 * server verifies every request.
 */
export function readJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  const payloadSegment = parts[1]
  if (parts.length < 2 || !payloadSegment) return null

  try {
    const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/')
    const pad =
      padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
    const payload: unknown = JSON.parse(atob(padded + pad))
    return payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Reads `exp` from a JWT payload without verifying the signature.
 * Opaque / malformed tokens return `null` so callers can fall back to
 * a server-side validate instead of treating them as expired.
 */
export function readJwtExpiryMs(token: string): number | null {
  const exp = readJwtPayload(token)?.exp
  return typeof exp === 'number' ? exp * 1000 : null
}

export function isJwtExpired(token: string, now = Date.now()): boolean {
  const expiryMs = readJwtExpiryMs(token)
  if (expiryMs == null) return false
  return expiryMs <= now
}

export function isJwtDueForRefresh(token: string, now = Date.now()): boolean {
  const expiryMs = readJwtExpiryMs(token)
  if (expiryMs == null) return false
  return expiryMs - now <= SESSION_REFRESH_BUFFER_MS
}
