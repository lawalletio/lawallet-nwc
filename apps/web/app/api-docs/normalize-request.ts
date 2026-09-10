export interface NormalizedRequest {
  url: string
  method: string
  headers: Headers
  /** What we feed back to the underlying `fetch` after rewriting the header. */
  realBody: BodyInit | null | undefined
  /** What we feed to `createNip98Token` for the payload hash. */
  bodyForHash: BodyInit | null | undefined
}

/**
 * Materialise a fetch `(input, init)` pair so the API-docs interceptor can
 * both hash the body for NIP-98 and re-issue the request with a new
 * Authorization header.
 *
 * Scalar's browser "Try it out" calls `fetch(new Request(...))`. Request
 * bodies are one-shot, so we clone before reading and reuse the text for
 * both the payload hash and the re-send.
 */
export async function normalizeRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<NormalizedRequest | null> {
  if (input instanceof Request) {
    const method = (init?.method ?? input.method).toUpperCase()
    const headers = new Headers(init?.headers ?? input.headers)
    // Fetch spec: `init.body` overrides the Request body. Otherwise clone
    // so the original Request stays readable if we fall through.
    if (init?.body !== undefined) {
      return {
        url: input.url,
        method,
        headers,
        realBody: init.body,
        bodyForHash: init.body ?? undefined
      }
    }
    const bodyText = await input.clone().text()
    return {
      url: input.url,
      method,
      headers,
      realBody: bodyText || null,
      bodyForHash: bodyText || undefined
    }
  }
  const urlString = typeof input === 'string' ? input : input.toString()
  const method = (init?.method ?? 'GET').toUpperCase()
  const headers = new Headers(init?.headers ?? {})
  return {
    url: urlString,
    method,
    headers,
    realBody: init?.body ?? null,
    bodyForHash: init?.body ?? undefined
  }
}

export function shouldAutoSign(
  req: NormalizedRequest,
  nip98Routes: Set<string>
): boolean {
  let pathname: string
  try {
    pathname = new URL(req.url, window.location.origin).pathname
  } catch {
    return false
  }
  // Direct match.
  if (nip98Routes.has(`${req.method} ${pathname}`)) return true
  // Match parameterized paths (e.g. /api/cards/{id}) by treating each spec
  // segment that looks like `{xxx}` as a wildcard.
  for (const route of nip98Routes) {
    const [m, p] = route.split(' ')
    if (m !== req.method) continue
    if (matchTemplate(p, pathname)) return true
  }
  return false
}

function matchTemplate(template: string, actual: string): boolean {
  const tParts = template.split('/')
  const aParts = actual.split('/')
  if (tParts.length !== aParts.length) return false
  for (let i = 0; i < tParts.length; i++) {
    const t = tParts[i]
    if (t.startsWith('{') && t.endsWith('}')) continue
    if (t !== aParts[i]) return false
  }
  return true
}
