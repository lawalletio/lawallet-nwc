function normalizePart(value?: string): string {
  return value?.trim().toLowerCase() || ''
}

/**
 * Whether a host is this machine. Drives http-vs-https everywhere we build a
 * URL for a host we did not hard-code — guessing from `NODE_ENV` instead is
 * the bug that makes a dev build unable to talk to any real domain.
 */
export function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.startsWith('localhost:') ||
    host.endsWith('.localhost') ||
    host.includes('.localhost:') ||
    host.startsWith('127.')
  )
}

/**
 * Normalizes the configured `domain` into a host string, lowercasing and
 * trimming it. Returns `''` when `domain` is missing.
 */
export function buildPublicHost(domain?: string): string {
  return normalizePart(domain)
}

/**
 * Wraps `host` in a scheme — `http://` for any localhost variant,
 * `https://` otherwise. Returns `''` when `host` is missing.
 */
export function buildPublicUrl(host?: string): string {
  const cleanHost = normalizePart(host)

  if (!cleanHost) {
    return ''
  }

  return `${isLocalHost(cleanHost) ? 'http' : 'https'}://${cleanHost}`
}

/**
 * Parses the configured `endpoint` setting, which holds either a full URL
 * (`https://app.example.com:8080`) or a bare host (`app.example.com:8080`).
 * Trims whitespace, strips trailing slashes, and lowercases the result.
 *
 * Protocol resolution:
 * - If the input has `http://` or `https://`, that scheme is preserved.
 * - If no scheme is present, falls back to `https://` — except for localhost
 *   variants which fall back to `http://`.
 *
 * Returns `null` for empty or unparseable input.
 */
export function parseEndpoint(
  value?: string | null
): { protocol: 'http:' | 'https:'; host: string } | null {
  const cleaned = value?.trim().replace(/\/+$/, '').toLowerCase()
  if (!cleaned) return null

  const schemeMatch = cleaned.match(/^(https?):\/\/(.+)$/)
  if (schemeMatch) {
    const host = schemeMatch[2]
    if (!host) return null
    return { protocol: `${schemeMatch[1]}:` as 'http:' | 'https:', host }
  }

  // No scheme — fallback to https (or http for localhost variants).
  return {
    protocol: isLocalHost(cleaned) ? 'http:' : 'https:',
    host: cleaned
  }
}
