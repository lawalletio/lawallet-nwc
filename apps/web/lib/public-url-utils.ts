function normalizePart(value?: string): string {
  return value?.trim().toLowerCase() || ''
}

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.startsWith('localhost:') ||
    host.endsWith('.localhost') ||
    host.includes('.localhost:') ||
    host.startsWith('127.')
  )
}

/**
 * Joins a domain and optional subdomain into a single host string,
 * lowercasing and trimming both. Returns `''` when `domain` is missing.
 */
export function buildPublicHost(domain?: string, subdomain?: string): string {
  const cleanDomain = normalizePart(domain)
  const cleanSubdomain = normalizePart(subdomain)

  if (!cleanDomain) {
    return ''
  }

  return cleanSubdomain ? `${cleanSubdomain}.${cleanDomain}` : cleanDomain
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
