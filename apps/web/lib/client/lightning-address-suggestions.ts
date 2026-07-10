const DOMAIN_AVATAR_BASE_URL =
  'https://raw.githubusercontent.com/lawalletio/static/main/public/img/domains'
const DEFAULT_DOMAIN = 'lawallet.io'
const DEFAULT_DOMAIN_AVATAR = `${DOMAIN_AVATAR_BASE_URL}/default.png`
const USERNAME_RE = /^[a-z0-9._-]{1,64}$/
const PUBLIC_DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i

interface DomainOption {
  domain: string
  avatarSlug?: string
}

export interface LightningAddressSuggestion {
  lightningAddress: string
  username: string
  domain: string
  avatarUrl: string
}

const BASE_DOMAIN_OPTIONS: readonly DomainOption[] = [
  { domain: 'lacrypta.ar' },
  { domain: 'lawallet.io', avatarSlug: 'lawallet.ar' },
  { domain: 'walletofsatoshi.com' },
  { domain: 'blink.sv' },
  { domain: 'strike.me' },
  { domain: 'getalby.com' },
  { domain: 'ln.tips' },
  { domain: 'stacker.news' },
  { domain: 'primal.net' },
  { domain: 'fountain.fm' },
  { domain: 'coinos.io' },
  { domain: 'bitrefill.me' },
  { domain: 'zbd.gg' },
  { domain: 'npub.cash' },
]

const AVATAR_SLUG_BY_DOMAIN = new Map(
  BASE_DOMAIN_OPTIONS.map(option => [
    option.domain,
    option.avatarSlug ?? option.domain,
  ]),
)

export function resolveCurrentLightningDomain(
  lightningAddress: string | null | undefined,
): string {
  const domain = lightningAddress?.split('@')[1]?.trim().toLowerCase()
  return domain && PUBLIC_DOMAIN_RE.test(domain) ? domain : DEFAULT_DOMAIN
}

export function getDomainAvatarUrl(domain: string): string {
  const normalized = domain.trim().toLowerCase()
  if (!PUBLIC_DOMAIN_RE.test(normalized)) return DEFAULT_DOMAIN_AVATAR
  const slug = AVATAR_SLUG_BY_DOMAIN.get(normalized)
  return slug
    ? `${DOMAIN_AVATAR_BASE_URL}/${slug}.png`
    : DEFAULT_DOMAIN_AVATAR
}

export function buildLightningAddressSuggestions(
  input: string,
  currentDomain: string,
  excludedAddresses: Iterable<string> = [],
  limit = 10,
): LightningAddressSuggestion[] {
  const parsed = parseSuggestionInput(input)
  if (!parsed) return []

  const excluded = new Set(
    Array.from(excludedAddresses, address => address.trim().toLowerCase()),
  )

  return orderedDomains(currentDomain)
    .filter(option => {
      if (!parsed.domainQuery) return true
      return option.domain.startsWith(parsed.domainQuery)
    })
    .map(option => {
      const lightningAddress = `${parsed.username}@${option.domain}`
      return {
        lightningAddress,
        username: parsed.username,
        domain: option.domain,
        avatarUrl: getDomainAvatarUrl(option.domain),
      }
    })
    .filter(option => !excluded.has(option.lightningAddress))
    .slice(0, limit)
}

function parseSuggestionInput(
  input: string,
): { username: string; domainQuery: string } | null {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return null
  if (/^(lnbc|lntb|lnbcrt|lnurl1|npub1)/.test(normalized)) return null

  const withoutScheme = normalized.startsWith('lightning:')
    ? normalized.slice('lightning:'.length)
    : normalized
  const atIndex = withoutScheme.indexOf('@')
  const username =
    atIndex >= 0 ? withoutScheme.slice(0, atIndex) : withoutScheme
  const domainQuery = atIndex >= 0 ? withoutScheme.slice(atIndex + 1) : ''

  if (!USERNAME_RE.test(username)) return null
  return { username, domainQuery }
}

function orderedDomains(currentDomain: string): DomainOption[] {
  const normalizedCurrent = PUBLIC_DOMAIN_RE.test(currentDomain)
    ? currentDomain.toLowerCase()
    : DEFAULT_DOMAIN
  const current: DomainOption = {
    domain: normalizedCurrent,
    avatarSlug: AVATAR_SLUG_BY_DOMAIN.get(normalizedCurrent),
  }
  const options = [current, ...BASE_DOMAIN_OPTIONS]
  const seen = new Set<string>()
  return options.filter(option => {
    if (seen.has(option.domain)) return false
    seen.add(option.domain)
    return true
  })
}
