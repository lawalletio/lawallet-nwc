import { ValidationError } from '@/types/server/errors'

/**
 * Whether insecure service URLs are tolerated. The coupons spec requires
 * https for announced endpoints but explicitly allows localhost in dev, and
 * the reference service is developed that way — so mirror that instead of
 * forcing integrators onto TLS on their laptop.
 */
export function allowsInsecureServiceUrls(): boolean {
  return process.env.NODE_ENV !== 'production'
}

/**
 * Validate a coupon-manager service endpoint at the trust boundary.
 *
 * This runs on *input* (deposit) so a bad URL is rejected once, at write time,
 * rather than every time the status refresh reads the row. The refresh path
 * still applies its own DNS-pinning SSRF checks — this is the shape check, not
 * the network check.
 *
 * @throws ValidationError naming the offending field.
 */
export function assertServiceUrl(value: string, field: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ValidationError(`${field} is not a valid URL`)
  }
  if (url.username || url.password) {
    throw new ValidationError(`${field} must not contain credentials`)
  }
  if (url.protocol === 'https:') return url
  if (url.protocol === 'http:' && allowsInsecureServiceUrls()) return url
  throw new ValidationError(`${field} must use https`)
}
