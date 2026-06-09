import { parseEndpoint } from '@/lib/public-url-utils'

export type ProbeState = 'pass' | 'fail' | 'skip'
export type PlatformKind =
  | 'lawallet'
  | 'wordpress'
  | 'nextjs'
  | 'vite'
  | 'php'
  | 'nginx'
  | 'vercel'
  | 'netlify'
  | 'cloudflare'
  | 'static'
  | 'unknown'

export interface DomainProbeRequest {
  domain: string
  endpoint?: string
  apiGatewayEndpoint?: string
  lnurlUsername?: string
}

export interface ProbeCheck {
  state: ProbeState
  url: string
  label: string
  detail: string
}

export interface PlatformDetection {
  kind: PlatformKind
  label: string
  confidence: 'high' | 'medium' | 'low'
  evidence: string[]
}

export interface InstructionProfile {
  title: string
  summary: string
  snippet: string
  tip: string
}

export interface DomainProbeResult {
  domain: string
  endpoint: string
  direct: boolean
  status: 'ready' | 'rewrite-needed' | 'pending'
  checks: {
    instance: ProbeCheck
    lnurl: ProbeCheck
    nip05: ProbeCheck
  }
  platform: PlatformDetection
  instructions: InstructionProfile
}

export interface RootSample {
  url: string
  status: number
  headers: Record<string, string>
  body: string
  error?: string
}

const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

const FETCH_TIMEOUT_MS = 5000
const BODY_LIMIT = 80_000

function cleanHost(value: string): string {
  return value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host.startsWith('localhost:') || host.startsWith('127.')
}

export function normalizeDomainProbeInput(input: DomainProbeRequest): {
  domain: string
  endpoint: string
} {
  const domain = cleanHost(input.domain)
  if (!DOMAIN_PATTERN.test(domain) && !isLocalHost(domain)) {
    throw new Error('Enter a valid domain without protocol')
  }

  const parsedEndpoint = parseEndpoint(input.endpoint)
  const endpoint = parsedEndpoint
    ? `${parsedEndpoint.protocol}//${parsedEndpoint.host}`
    : `${isLocalHost(domain) ? 'http' : 'https'}://${domain}`

  return { domain, endpoint }
}

export function detectPlatform(sample: RootSample): PlatformDetection {
  const headersText = Object.entries(sample.headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
    .toLowerCase()
  const body = sample.body.toLowerCase()
  const haystack = `${headersText}\n${body}`
  const evidence: string[] = []

  function has(pattern: RegExp, label: string): boolean {
    const matched = pattern.test(haystack)
    if (matched) evidence.push(label)
    return matched
  }

  if (
    has(/lawallet|lnurlp|lightning address|nostr/i, 'LaWallet or Lightning metadata') &&
    has(/_next\/static|x-powered-by:\s*next\.js/i, 'Next.js assets')
  ) {
    return {
      kind: 'lawallet',
      label: 'LaWallet',
      confidence: 'medium',
      evidence,
    }
  }

  if (has(/wp-content|wp-includes|wp-json|generator" content="wordpress/i, 'WordPress markers')) {
    return { kind: 'wordpress', label: 'WordPress', confidence: 'high', evidence }
  }

  if (has(/x-vercel|server:\s*vercel/i, 'Vercel headers')) {
    return { kind: 'vercel', label: 'Vercel', confidence: 'high', evidence }
  }

  if (has(/x-nf-request-id|server:\s*netlify/i, 'Netlify headers')) {
    return { kind: 'netlify', label: 'Netlify', confidence: 'high', evidence }
  }

  if (has(/cf-ray|server:\s*cloudflare/i, 'Cloudflare headers')) {
    return { kind: 'cloudflare', label: 'Cloudflare', confidence: 'medium', evidence }
  }

  if (has(/__next_data__|\/_next\/static|x-powered-by:\s*next\.js/i, 'Next.js markers')) {
    return { kind: 'nextjs', label: 'Next.js', confidence: 'high', evidence }
  }

  if (has(/\/@vite\/client|vite.svg|type="module" crossorigin/i, 'Vite markers')) {
    return { kind: 'vite', label: 'Vite/static', confidence: 'medium', evidence }
  }

  if (has(/x-powered-by:\s*php|\.php\b/i, 'PHP markers')) {
    return { kind: 'php', label: 'PHP', confidence: 'medium', evidence }
  }

  if (has(/server:\s*nginx/i, 'Nginx server')) {
    return { kind: 'nginx', label: 'Nginx', confidence: 'medium', evidence }
  }

  if (sample.status > 0 && sample.status < 500) {
    return {
      kind: 'static',
      label: 'Static site',
      confidence: 'low',
      evidence: ['root page responded'],
    }
  }

  return {
    kind: 'unknown',
    label: 'Unknown stack',
    confidence: 'low',
    evidence: sample.error ? [sample.error] : [],
  }
}

export function buildInstructionProfile(
  platform: PlatformDetection,
  domain: string,
  endpoint: string,
): InstructionProfile {
  const target = endpoint.replace(/\/+$/, '')
  const tip = `You can host LaWallet at lawallet.${domain} and keep ${domain} for a landing page. Only .well-known needs to route here.`

  const snippets: Record<PlatformKind, InstructionProfile> = {
    lawallet: {
      title: 'Domain is already on LaWallet',
      summary: 'No rewrite is needed. Keep this setup.',
      snippet: `/.well-known/* is already served by ${target}`,
      tip,
    },
    wordpress: {
      title: 'Add a WordPress rewrite',
      summary: 'Route only .well-known to this LaWallet instance.',
      snippet: `# .htaccess before WordPress rules\nRewriteEngine On\nRewriteRule ^\\.well-known/(.*)$ ${target}/.well-known/$1 [R=307,L]`,
      tip,
    },
    nextjs: {
      title: 'Add a Next.js rewrite',
      summary: 'Keep the site, route wallet discovery to LaWallet.',
      snippet: `// next.config.js\nasync rewrites() {\n  return [\n    { source: '/.well-known/:path*', destination: '${target}/.well-known/:path*' },\n  ]\n}`,
      tip,
    },
    vite: {
      title: 'Add a hosting rewrite',
      summary: 'Configure your host to proxy .well-known.',
      snippet: `/.well-known/*  ${target}/.well-known/:splat  200`,
      tip,
    },
    php: {
      title: 'Add an Apache/PHP rewrite',
      summary: 'Proxy discovery requests without moving the website.',
      snippet: `RewriteEngine On\nRewriteRule ^\\.well-known/(.*)$ ${target}/.well-known/$1 [R=307,L]`,
      tip,
    },
    nginx: {
      title: 'Add an Nginx location',
      summary: 'Proxy only the discovery paths.',
      snippet: `location /.well-known/ {\n  proxy_pass ${target}/.well-known/;\n  proxy_set_header Host $host;\n}`,
      tip,
    },
    vercel: {
      title: 'Add a Vercel rewrite',
      summary: 'Place this in vercel.json or Next rewrites.',
      snippet: `{\n  "rewrites": [\n    { "source": "/.well-known/:path*", "destination": "${target}/.well-known/:path*" }\n  ]\n}`,
      tip,
    },
    netlify: {
      title: 'Add a Netlify rewrite',
      summary: 'Place this in _redirects.',
      snippet: `/.well-known/*  ${target}/.well-known/:splat  200`,
      tip,
    },
    cloudflare: {
      title: 'Add a Cloudflare rule',
      summary: 'Forward .well-known to the LaWallet endpoint.',
      snippet: `if (url.pathname.startsWith('/.well-known/')) {\n  return fetch('${target}' + url.pathname + url.search)\n}`,
      tip,
    },
    static: {
      title: 'Add a static-host rewrite',
      summary: 'Most hosts call this redirects or rewrites.',
      snippet: `/.well-known/*  ${target}/.well-known/:splat  200`,
      tip,
    },
    unknown: {
      title: 'Add a .well-known rewrite',
      summary: 'Use your web server or DNS proxy to forward discovery.',
      snippet: `/.well-known/* -> ${target}/.well-known/*`,
      tip,
    },
  }

  return snippets[platform.kind]
}

function pass(label: string, url: string, detail: string): ProbeCheck {
  return { state: 'pass', label, url, detail }
}

function fail(label: string, url: string, detail: string): ProbeCheck {
  return { state: 'fail', label, url, detail }
}

function skip(label: string, url: string, detail: string): ProbeCheck {
  return { state: 'skip', label, url, detail }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'application/json,text/html;q=0.8,*/*;q=0.5',
        'User-Agent': 'LaWallet domain onboarding',
      },
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function sampleRoot(domain: string): Promise<RootSample> {
  const url = `${isLocalHost(domain) ? 'http' : 'https'}://${domain}`
  try {
    const response = await fetchWithTimeout(url)
    const text = await response.text()
    return {
      url,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: text.slice(0, BODY_LIMIT),
    }
  } catch (error) {
    return {
      url,
      status: 0,
      headers: {},
      body: '',
      error: error instanceof Error ? error.message : 'Root fetch failed',
    }
  }
}

async function probeLnurl(domain: string, endpoint: string, username: string): Promise<ProbeCheck> {
  if (!username) {
    return skip(
      'LNURL',
      `https://${domain}/.well-known/lnurlp/{username}`,
      'Create a Lightning Address to run this check.',
    )
  }

  const url = `${isLocalHost(domain) ? 'http' : 'https'}://${domain}/.well-known/lnurlp/${encodeURIComponent(username)}`
  try {
    const response = await fetchWithTimeout(url)
    const body = await response.json().catch(() => null)
    const callback = typeof body?.callback === 'string' ? body.callback : ''
    if (response.ok && callback.startsWith(endpoint)) {
      return pass('LNURL', url, 'Discovery reaches this instance.')
    }
    return fail('LNURL', url, 'Discovery did not return this instance callback.')
  } catch {
    return fail('LNURL', url, 'Discovery request failed.')
  }
}

async function probeLawalletInstance(domain: string): Promise<ProbeCheck> {
  const probeId = crypto.randomUUID()
  const url = `${isLocalHost(domain) ? 'http' : 'https'}://${domain}/.well-known/lawallet.json?probe=${encodeURIComponent(probeId)}`
  try {
    const response = await fetchWithTimeout(url)
    const body = await response.json().catch(() => null)
    if (
      response.ok &&
      body?.service === 'lawallet' &&
      body?.probe === probeId
    ) {
      return pass('LaWallet', url, 'Discovery routes to this LaWallet instance.')
    }
    return fail('LaWallet', url, 'Discovery is not routed to this LaWallet instance.')
  } catch {
    return fail('LaWallet', url, 'LaWallet instance probe failed.')
  }
}

async function probeNip05(domain: string): Promise<ProbeCheck> {
  const url = `${isLocalHost(domain) ? 'http' : 'https'}://${domain}/.well-known/nostr.json?name=_`
  try {
    const response = await fetchWithTimeout(url)
    const body = await response.json().catch(() => null)
    if (response.ok && body && typeof body.names === 'object') {
      return pass('NIP-05', url, 'Nostr discovery is reachable.')
    }
    return fail('NIP-05', url, 'Nostr discovery did not return names.')
  } catch {
    return fail('NIP-05', url, 'Nostr discovery request failed.')
  }
}

export async function probeDomainRouting(input: DomainProbeRequest): Promise<DomainProbeResult> {
  const { domain, endpoint } = normalizeDomainProbeInput(input)
  const apiGatewayEndpoint = input.apiGatewayEndpoint
    ? normalizeDomainProbeInput({
        domain,
        endpoint: input.apiGatewayEndpoint,
      }).endpoint
    : ''
  const lnurlUsername = input.lnurlUsername?.trim().toLowerCase() ?? ''
  const root = await sampleRoot(domain)
  const platform = detectPlatform(root)
  const endpointHost = cleanHost(endpoint)
  const gatewayHost = apiGatewayEndpoint ? cleanHost(apiGatewayEndpoint) : ''
  const effectiveEndpoint =
    platform.kind !== 'lawallet' &&
    endpointHost === domain &&
    apiGatewayEndpoint &&
    gatewayHost !== domain
      ? apiGatewayEndpoint
      : endpoint

  const [instance, lnurl, nip05] = await Promise.all([
    probeLawalletInstance(domain),
    probeLnurl(domain, effectiveEndpoint, lnurlUsername),
    probeNip05(domain),
  ])
  const direct = instance.state === 'pass' && cleanHost(effectiveEndpoint) === domain
  const ready =
    instance.state === 'pass' &&
    [lnurl, nip05].every(check => check.state === 'pass' || check.state === 'skip')
  const status = ready ? 'ready' : direct ? 'pending' : 'rewrite-needed'
  const instructionPlatform =
    platform.kind === 'lawallet' && instance.state !== 'pass'
      ? {
          kind: 'unknown',
          label: 'Unknown stack',
          confidence: 'low',
          evidence: platform.evidence,
        } satisfies PlatformDetection
      : platform

  return {
    domain,
    endpoint: effectiveEndpoint,
    direct,
    status,
    checks: { instance, lnurl, nip05 },
    platform,
    instructions: buildInstructionProfile(instructionPlatform, domain, effectiveEndpoint),
  }
}
