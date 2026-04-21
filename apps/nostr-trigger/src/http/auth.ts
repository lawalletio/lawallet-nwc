import type { MiddlewareHandler } from 'hono'
import { getConfig } from '../config/index.js'
import { AuthenticationError } from './errors.js'

/**
 * Bearer-token admin auth. Constant-time comparison to resist timing attacks.
 */
export const bearerAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization') ?? ''
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw new AuthenticationError('Missing Bearer token')
  }
  const presented = header.slice(7).trim()
  const expected = getConfig().http.adminSecret
  if (!constantTimeEqual(presented, expected)) {
    throw new AuthenticationError('Invalid admin token')
  }
  return next()
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
