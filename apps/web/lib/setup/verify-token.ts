import { randomBytes } from 'node:crypto'

const TTL_MS = 5 * 60 * 1000

let current: { token: string; expiresAt: number } | null = null

/**
 * Issues a fresh setup verification token and replaces any previous one.
 * Single-slot by design — only one operator should be running first-time
 * setup at a time.
 *
 * @returns A 48-char hex token, valid for {@link TTL_MS}.
 */
export function issueVerifyToken(): string {
  const token = randomBytes(24).toString('hex')
  current = { token, expiresAt: Date.now() + TTL_MS }
  return token
}

/**
 * @returns The currently-issued setup token, or `null` if none has been issued
 *   or the active one has expired (in which case it's also cleared).
 */
export function getVerifyToken(): string | null {
  if (!current) return null
  if (Date.now() > current.expiresAt) {
    current = null
    return null
  }
  return current.token
}
