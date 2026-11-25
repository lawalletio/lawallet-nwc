import { ServiceUnavailableError, ValidationError } from '@/types/server/errors'

/**
 * Minimal DNS write access for BIP-353: one TXT record per fully-qualified
 * name. Implementations upsert (never duplicate) and treat a missing record
 * as already deleted.
 */
export interface DnsProvider {
  setTxt(fqdn: string, value: string): Promise<void>
  deleteTxt(fqdn: string): Promise<void>
  /** Credential/connectivity check for the admin Test button. */
  test(): Promise<string>
}

const TIMEOUT_MS = 10_000
const TTL = 300

type Json = Record<string, unknown>

async function call(
  provider: string,
  url: string,
  token: string,
  method = 'GET',
  body?: Json
): Promise<Json> {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const data = ((await res.json().catch(() => ({}))) ?? {}) as Json
  if (!res.ok || data.success === false) {
    const err = data.error as { message?: string } | undefined
    const errors = data.errors as { message?: string }[] | undefined
    const msg = err?.message || errors?.[0]?.message || `HTTP ${res.status}`
    throw new ServiceUnavailableError(`${provider}: ${msg}`)
  }
  return data
}

// ── Vercel ────────────────────────────────────────────────────────────────

interface VercelRecord {
  id: string
  name: string
  type: string
}

export function vercelDns(cfg: {
  token: string
  zone: string
  teamId?: string
}): DnsProvider {
  const API = 'https://api.vercel.com'
  const zone = cfg.zone.toLowerCase()
  const team = cfg.teamId ? `teamId=${encodeURIComponent(cfg.teamId)}` : ''
  const q = (extra = '') => {
    const s = [team, extra].filter(Boolean).join('&')
    return s ? `?${s}` : ''
  }
  const v = (path: string, method?: string, body?: Json) =>
    call('Vercel', `${API}${path}`, cfg.token, method, body)

  /** Vercel names records relative to the zone apex. */
  function relative(fqdn: string): string {
    const name = fqdn.toLowerCase()
    if (!name.endsWith(`.${zone}`)) {
      throw new ValidationError(
        `Vercel DNS: ${fqdn} is not inside the zone ${zone}`
      )
    }
    return name.slice(0, -(zone.length + 1))
  }

  async function find(name: string): Promise<VercelRecord | undefined> {
    let until: unknown
    // ponytail: linear scan of the zone's records; Vercel has no name filter.
    do {
      const page = await v(
        `/v4/domains/${zone}/records${q(`limit=100${until ? `&until=${until}` : ''}`)}`
      )
      const hit = (page.records as VercelRecord[] | undefined)?.find(
        r => r.type === 'TXT' && r.name === name
      )
      if (hit) return hit
      until = (page.pagination as { next?: unknown } | undefined)?.next
    } while (until)
    return undefined
  }

  return {
    async setTxt(fqdn, value) {
      const name = relative(fqdn)
      const existing = await find(name)
      if (existing) {
        await v(`/v1/domains/records/${existing.id}${q()}`, 'PATCH', {
          value,
          ttl: TTL
        })
      } else {
        await v(`/v2/domains/${zone}/records${q()}`, 'POST', {
          name,
          type: 'TXT',
          value,
          ttl: TTL
        })
      }
    },
    async deleteTxt(fqdn) {
      const existing = await find(relative(fqdn))
      if (existing) {
        await v(`/v2/domains/${zone}/records/${existing.id}${q()}`, 'DELETE')
      }
    },
    async test() {
      await v(`/v4/domains/${zone}/records${q('limit=1')}`)
      return `Connected to ${zone}. Note: Vercel DNS does not sign zones with DNSSEC, which BIP-353 requires.`
    }
  }
}

// ── Cloudflare ────────────────────────────────────────────────────────────

export function cloudflareDns(cfg: {
  token: string
  zoneId: string
}): DnsProvider {
  const base = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(cfg.zoneId)}`
  const cf = (path: string, method?: string, body?: Json) =>
    call('Cloudflare', `${base}${path}`, cfg.token, method, body)

  async function find(fqdn: string): Promise<string | undefined> {
    const data = await cf(
      `/dns_records?type=TXT&name=${encodeURIComponent(fqdn.toLowerCase())}`
    )
    return (data.result as { id: string }[] | undefined)?.[0]?.id
  }

  return {
    async setTxt(fqdn, value) {
      // Cloudflare wants TXT content quoted; it warns (and quotes) otherwise.
      const body = {
        type: 'TXT',
        name: fqdn.toLowerCase(),
        content: `"${value}"`,
        ttl: TTL
      }
      const id = await find(fqdn)
      if (id) await cf(`/dns_records/${id}`, 'PUT', body)
      else await cf('/dns_records', 'POST', body)
    },
    async deleteTxt(fqdn) {
      const id = await find(fqdn)
      if (id) await cf(`/dns_records/${id}`, 'DELETE')
    },
    async test() {
      const data = await cf('/dnssec')
      const status = (data.result as { status?: string } | undefined)?.status
      return status === 'active'
        ? 'Connected. DNSSEC is active on the zone.'
        : `Connected, but DNSSEC is ${status ?? 'unknown'} — BIP-353 wallets will reject the records until it is active.`
    }
  }
}
