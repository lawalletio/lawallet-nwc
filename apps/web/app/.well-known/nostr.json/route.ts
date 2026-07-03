import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { getSettings } from '@/lib/settings'
import { DEFAULT_NOSTR_RELAYS } from '@/lib/nostr/profile'
import { resolveUserRelays } from '@/lib/nostr/relay-list'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// NIP-05 verification is fetched cross-origin by browser-based Nostr clients,
// so the spec requires the endpoint to be reachable from any origin.
// See: https://github.com/nostr-protocol/nips/blob/master/05.md
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
} as const

/**
 * Parse the operator's configured relay list — a JSON-stringified `string[]`
 * persisted under the `relays` setting (edited on the Infrastructure tab).
 * Falls back to DEFAULT_NOSTR_RELAYS when unset, empty, or malformed so NIP-05
 * always advertises somewhere clients can find the user's events.
 */
function resolveOperatorRelays(raw: string | undefined): string[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const relays = parsed
          .filter((relay): relay is string => typeof relay === 'string')
          .map(relay => relay.trim())
          .filter(relay => relay.startsWith('wss://') || relay.startsWith('ws://'))
        if (relays.length > 0) return Array.from(new Set(relays))
      }
    } catch {
      // Malformed setting — fall through to the safe defaults below.
    }
  }
  return DEFAULT_NOSTR_RELAYS
}

export const OPTIONS = () => new NextResponse(null, { status: 204, headers: CORS_HEADERS })

const EMPTY = { names: {}, relays: {} }

export const GET = withErrorHandling(async (request: NextRequest) => {
  // NIP-05 uses `?name=<localpart>`; accept `?username=` too since that's how
  // this platform labels the field elsewhere.
  const params = request.nextUrl.searchParams
  const name = (params.get('name') ?? params.get('username'))?.trim().toLowerCase()

  // A lookup is always for a specific name. Without one — or for the reserved
  // `_` root — return empty maps rather than enumerating every registered
  // user: the address book is not public.
  if (!name || name === '_') {
    return NextResponse.json(EMPTY, { headers: CORS_HEADERS })
  }

  const address = await prisma.lightningAddress.findUnique({
    where: { username: name },
    include: {
      user: {
        select: { id: true, pubkey: true, relays: true, relaysUpdatedAt: true },
      },
    },
  })

  // Unknown name → empty maps (a plain 200, so clients read it as "no such
  // identity" rather than a server error).
  if (!address) {
    return NextResponse.json(EMPTY, { headers: CORS_HEADERS })
  }

  const { pubkey } = address.user

  // NIP-05 `relays` (NIP-65): advertise where this pubkey publishes. Prefer the
  // user's own relay list — their manual picker choice or their cached kind:10002
  // relay list (resolved + cached here) — and only fall back to the operator's
  // configured relays when the user has none.
  const [userRelays, settings] = await Promise.all([
    resolveUserRelays(address.user),
    getSettings(['relays']),
  ])
  const relays =
    userRelays.length > 0 ? userRelays : resolveOperatorRelays(settings.relays)

  return NextResponse.json(
    {
      names: { [address.username]: pubkey },
      relays: { [pubkey]: relays },
    },
    { headers: CORS_HEADERS },
  )
})
