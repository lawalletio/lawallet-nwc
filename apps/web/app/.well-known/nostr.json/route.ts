import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { getSettings } from '@/lib/settings'
import { DEFAULT_NOSTR_RELAYS } from '@/lib/nostr/profile'

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
  const name = request.nextUrl.searchParams.get('name')?.trim().toLowerCase()

  // NIP-05 lookups are always for a specific `name` (`?name=<localpart>`).
  // Without one — or for the reserved `_` root — we return empty maps rather
  // than enumerating every registered user: the address book is not public.
  if (!name || name === '_') {
    return NextResponse.json(EMPTY, { headers: CORS_HEADERS })
  }

  const address = await prisma.lightningAddress.findUnique({
    where: { username: name },
    include: { user: { select: { pubkey: true } } },
  })

  // Unknown name → empty maps (a plain 200, so clients read it as "no such
  // identity" rather than a server error).
  if (!address) {
    return NextResponse.json(EMPTY, { headers: CORS_HEADERS })
  }

  const pubkey = address.user.pubkey

  // NIP-05 `relays`: tell clients where this pubkey publishes. Until the
  // per-user relay picker lands (M5 Theme C, still deferred), every identity
  // shares the operator's configured relay list.
  const settings = await getSettings(['relays'])
  const operatorRelays = resolveOperatorRelays(settings.relays)

  return NextResponse.json(
    {
      names: { [address.username]: pubkey },
      relays: { [pubkey]: operatorRelays },
    },
    { headers: CORS_HEADERS },
  )
})
