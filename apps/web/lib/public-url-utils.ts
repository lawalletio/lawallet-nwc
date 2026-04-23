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

export function buildPublicHost(domain?: string, subdomain?: string): string {
  const cleanDomain = normalizePart(domain)
  const cleanSubdomain = normalizePart(subdomain)

  if (!cleanDomain) {
    return ''
  }

  return cleanSubdomain ? `${cleanSubdomain}.${cleanDomain}` : cleanDomain
}

export function buildPublicUrl(host?: string): string {
  const cleanHost = normalizePart(host)

  if (!cleanHost) {
    return ''
  }

  return `${isLocalHost(cleanHost) ? 'http' : 'https'}://${cleanHost}`
}
