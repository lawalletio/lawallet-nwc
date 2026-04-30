import { randomBytes } from 'node:crypto'

const TTL_MS = 5 * 60 * 1000

let current: { token: string; expiresAt: number } | null = null

export function issueVerifyToken(): string {
  const token = randomBytes(24).toString('hex')
  current = { token, expiresAt: Date.now() + TTL_MS }
  return token
}

export function getVerifyToken(): string | null {
  if (!current) return null
  if (Date.now() > current.expiresAt) {
    current = null
    return null
  }
  return current.token
}
