import {
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
  ValidationError
} from '@/types/server/errors'

/**
 * Gorilla API client (github.com/agustinkassis/gorilla-api):
 * `GET {base}/v1/alias/:query` resolves an Argentine ALIAS / CBU / CVU to its
 * owner(s) and bank.
 *
 * ponytail: every lawallet request shares this server's egress IP, and
 * gorilla-api allows 30 req/min per IP. Needs a trusted-caller key upstream
 * once traffic outgrows that.
 */

const TIMEOUT_MS = 8_000

export interface AliasOwner {
  type: 'F' | 'J'
  cuit: string
  name: string
}

export interface AliasLookup {
  cvu: string
  alias: string | null
  bank: string
  icon: string | null
  owners: AliasOwner[]
}

function baseUrl(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError('Alias API URL must be http(s)')
  }
  return url.origin + url.pathname.replace(/\/+$/, '')
}

export async function lookupAlias(
  apiUrl: string,
  query: string
): Promise<AliasLookup> {
  const res = await fetch(
    `${baseUrl(apiUrl)}/v1/alias/${encodeURIComponent(query.trim().toLowerCase())}`,
    { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }
  )
  const d = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    if (res.status === 404) throw new NotFoundError('Bank account not found')
    if (res.status === 400)
      throw new ValidationError('Invalid alias or CBU/CVU')
    if (res.status === 429) {
      throw new TooManyRequestsError('Alias lookup rate limit reached', {
        retryAfter: Number(res.headers.get('retry-after')) || 60
      })
    }
    throw new ServiceUnavailableError('Alias lookup is unavailable')
  }
  const owners = Array.isArray(d.owners) ? d.owners : []
  return {
    cvu: String(d.cvu ?? ''),
    alias: typeof d.alias === 'string' ? d.alias : null,
    bank: String(d.bank ?? ''),
    icon: typeof d.icon === 'string' ? d.icon : null,
    owners: owners.map((o: Record<string, unknown>) => ({
      type: o.type === 'J' ? 'J' : 'F',
      cuit: String(o.cuit ?? ''),
      name: String(o.name ?? '')
    }))
  }
}

/** Admin Test button: gorilla-api `/status` (503 when Fiwind is down). */
export async function testAliasApi(apiUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl(apiUrl)}/status`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const d = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || d.status !== 'ok') {
    throw new ServiceUnavailableError(
      `Gorilla API is ${String(d.status ?? `HTTP ${res.status}`)}`
    )
  }
  return `Connected — gorilla-api ${String(d.version ?? '')}`.trim()
}
