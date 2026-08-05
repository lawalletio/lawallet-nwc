import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { getSettings } from '@/lib/settings'
import { DEFAULT_NOSTR_RELAYS, normalizeNostrPubkey } from '@/lib/nostr/profile'
import { resolveAccountPubkey } from '@/lib/nostr/account-pubkey'
import { resolveUserRelays } from '@/lib/nostr/relay-list'
import { PROXY_CONFIG_ID } from '@/lib/proxy/constants'
import {
  PUBLIC_READ_CORS_HEADERS,
  publicReadOptions,
  withPublicReadCors
} from '@/lib/public-cors'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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
          .filter(
            relay => relay.startsWith('wss://') || relay.startsWith('ws://')
          )
        if (relays.length > 0) return Array.from(new Set(relays))
      }
    } catch {
      // Malformed setting — fall through to the safe defaults below.
    }
  }
  return DEFAULT_NOSTR_RELAYS
}

export const OPTIONS = publicReadOptions

const EMPTY = { names: {}, relays: {} }

export const GET = withErrorHandling(
  withPublicReadCors(async (request: NextRequest) => {
    // NIP-05 uses `?name=<localpart>`; accept `?username=` too since that's how
    // this platform labels the field elsewhere.
    const params = request.nextUrl.searchParams
    const name = (params.get('name') ?? params.get('username'))
      ?.trim()
      .toLowerCase()

    // A lookup is always for a specific name. Without one, return empty maps
    // rather than enumerating every registered user: the address book is not
    // public.
    if (!name) {
      return NextResponse.json(EMPTY)
    }

    // The root-domain NIP-05 identity belongs to the zap receipt signer. Only
    // expose its public key; the encrypted private key never leaves the server.
    if (name === '_') {
      const [config, settings] = await Promise.all([
        prisma.proxyServiceConfig.findUnique({
          where: { id: PROXY_CONFIG_ID },
          select: { receiptPubkey: true }
        }),
        getSettings(['relays'])
      ])
      const normalizedPubkey = config?.receiptPubkey
        ? normalizeNostrPubkey(config.receiptPubkey)
        : null

      if (!normalizedPubkey) {
        return NextResponse.json(EMPTY)
      }

      const pubkey = normalizedPubkey.pubkey

      return NextResponse.json({
        names: { _: pubkey },
        relays: { [pubkey]: resolveOperatorRelays(settings.relays) }
      })
    }

    const address = await prisma.lightningAddress.findUnique({
      where: { username: name },
      include: {
        user: {
          select: {
            id: true,
            pubkey: true,
            relays: true,
            relaysUpdatedAt: true,
            nostrIdentities: {
              where: { isPrimary: true },
              select: { pubkey: true },
              take: 1
            }
          }
        }
      }
    })

    // Unknown name → empty maps (a plain 200, so clients read it as "no such
    // identity" rather than a server error).
    if (!address) {
      return NextResponse.json(EMPTY)
    }

    const normalizedPubkey = resolveAccountPubkey(address.user)
    if (!normalizedPubkey) {
      return NextResponse.json(EMPTY)
    }
    const pubkey = normalizedPubkey.pubkey

    // NIP-05 `relays` (NIP-65): advertise where this pubkey publishes. Prefer the
    // user's own relay list — their manual picker choice or their cached kind:10002
    // relay list (resolved + cached here) — and only fall back to the operator's
    // configured relays when the user has none.
    const [userRelays, settings] = await Promise.all([
      resolveUserRelays({ ...address.user, pubkey }),
      getSettings(['relays'])
    ])
    const relays =
      userRelays.length > 0
        ? userRelays
        : resolveOperatorRelays(settings.relays)

    return NextResponse.json({
      names: { [address.username]: pubkey },
      relays: { [pubkey]: relays }
    })
  }),
  { headers: PUBLIC_READ_CORS_HEADERS }
)
