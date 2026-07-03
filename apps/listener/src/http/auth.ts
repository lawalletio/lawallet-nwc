import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time bearer check. Both sides are hashed first so timingSafeEqual
 * always gets equal-length buffers and comparison time is independent of the
 * presented token's length or content.
 */
export function verifyBearer(
  header: string | undefined,
  secret: string
): boolean {
  if (!secret) return false
  const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
  const a = createHash('sha256').update(token).digest()
  const b = createHash('sha256').update(secret).digest()
  return timingSafeEqual(a, b)
}
