import { LUD06Response } from '@/types/lnurl'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import {
  lud16UsernameParam,
  LUD12_MAX_COMMENT_LENGTH
} from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import {
  resolvePublicEndpoint,
  resolveApiUrl,
  resolveAddressDomain
} from '@/lib/public-url'
import { LNURL_VERIFY_USERNAME } from '@/lib/domain-onboarding'
import {
  parseLightningAddress,
  resolveWalletRoute
} from '@/lib/wallet/resolve-payment-route'
import { getSettings } from '@/lib/settings'
import { lncurlHealTarget } from '@/lib/wallet/lncurl-wallet'
import {
  getLud16AvatarMetadataEntry,
  warmNostrProfileForLud16
} from '@/lib/nostr/lud16-avatar'
import { getPrimaryRemoteWalletForUser } from '@/lib/wallet/primary-wallet'
import { getActiveProxyConfig } from '@/lib/proxy/config'
import { getListenerConfig } from '@/lib/listener-config'
import {
  fetchDestinationMetadata,
  fetchDestinationPayRequest
} from '@/lib/proxy/lnurl'
import { resolveLocalDestination } from '@/lib/proxy/local-destination'
import { grossRangeForDestination } from '@/lib/proxy/money'
import { getZapReceiptCapability } from '@/lib/nostr/zap-receipts'
import {
  PUBLIC_READ_CORS_HEADERS,
  publicReadOptions,
  withPublicReadCors
} from '@/lib/public-cors'

/**
 * Follows an ALIAS chain while it stays on this instance and returns the first
 * address that must actually be fetched. Returns null when the chain is
 * malformed or loops back on itself.
 *
 * ALIAS moves no money — it hands the payer the destination's own payRequest —
 * so a local alias cycle is a request amplifier rather than a payment loop.
 * That is why it is bounded here rather than by the forwarding hop counter.
 */
async function followLocalAliases(
  redirect: string,
  from: string
): Promise<string | null> {
  let address = redirect
  const seen = new Set<string>([from])
  for (;;) {
    if (!parseLightningAddress(address)) return null
    const local = await resolveLocalDestination(address)
    if (!local) return address // leaves this instance — fetch it for real
    if (seen.has(local.username)) return null // a -> b -> a
    seen.add(local.username)

    const next = await prisma.lightningAddress.findUnique({
      where: { username: local.username },
      select: { mode: true, redirect: true }
    })
    // Anything that is not another local alias is served by us directly, so
    // the caller fetches it once over loopback and the walk is finished.
    if (!next || next.mode !== 'ALIAS' || !next.redirect?.trim()) {
      return address
    }
    address = next.redirect.trim()
  }
}

export const OPTIONS = publicReadOptions

export const GET = withErrorHandling(
  withPublicReadCors(
    async (
      req: NextRequest,
      { params }: { params: Promise<{ username: string }> }
    ) => {
      const { username: _username } = validateParams(
        await params,
        lud16UsernameParam
      )
      const username = _username.trim().toLowerCase()

      logger.info({ username }, 'LUD16 lookup request')

      const probe = req.nextUrl.searchParams.get('probe')?.trim()
      if (username === LNURL_VERIFY_USERNAME && probe) {
        const { host, url } = await resolvePublicEndpoint(req)

        return NextResponse.json({
          status: 'OK',
          tag: 'payRequest',
          callback: `${url}/api/lud16/${LNURL_VERIFY_USERNAME}/cb?probe=${encodeURIComponent(probe)}`,
          minSendable: 1000,
          maxSendable: 1000,
          metadata: JSON.stringify([
            ['text/plain', `LaWallet LNURL verification for ${host}: ${probe}`]
          ])
        } as LUD06Response & { status: 'OK' })
      }

      // Load the address along with its bound RemoteWallet (CUSTOM_NWC). The
      // DEFAULT_NWC wallet is derived from the user's primary address below.
      // Must stay in lockstep with the /cb route's query so metadata and
      // callback can't disagree.
      const lightningAddress = await prisma.lightningAddress.findUnique({
        where: { username },
        include: {
          remoteWallet: {
            select: { id: true, type: true, config: true, status: true }
          },
          user: {
            select: {
              id: true,
              // pubkey drives the cached-Nostr-avatar embed in the payRequest
              // metadata below.
              pubkey: true
            }
          }
        }
      })

      if (!lightningAddress) {
        throw new NotFoundError('Lightning address not found')
      }

      const primaryWallet = await getPrimaryRemoteWalletForUser(
        lightningAddress.user.id
      )

      const route = resolveWalletRoute({
        mode: lightningAddress.mode,
        redirect: lightningAddress.redirect,
        remoteWallet: lightningAddress.remoteWallet
      })

      // IDLE (disabled by the owner) is always a dead end — no LNURL here.
      if (route.kind === 'idle') {
        logger.info(
          { username, mode: lightningAddress.mode, reason: route.kind },
          'LUD16 lookup rejected'
        )
        throw new NotFoundError('User not configured for payments')
      }

      // `unconfigured` (no usable wallet) normally 404s too — UNLESS the operator
      // runs LNCurl with auto-recreate, in which case we promise a callback and
      // defer provisioning to /cb (so a bare lookup never mints a wallet). Stays
      // in lockstep with the /cb route, which performs the actual heal.
      if (route.kind === 'unconfigured') {
        const settings = await getSettings([
          'lncurl_enabled',
          'lncurl_auto_create',
          'lncurl_auto_recreate'
        ])
        const heal = lncurlHealTarget(
          {
            mode: lightningAddress.mode,
            boundWallet: lightningAddress.remoteWallet
          },
          settings
        )
        if (!heal) {
          logger.info(
            { username, mode: lightningAddress.mode, reason: route.kind },
            'LUD16 lookup rejected'
          )
          throw new NotFoundError('User not configured for payments')
        }
        logger.info(
          { username, mode: lightningAddress.mode },
          'LUD16 lookup served via LNCurl auto-heal (deferred provisioning)'
        )
      }

      // ALIAS: proxy the remote address's LUD-16 response verbatim. We return
      // the remote's `callback` / `verify` URLs as-is, so the sender's wallet
      // will POST directly to the aliased server on the next step — our /cb
      // route is never hit for alias addresses. Proxying (vs. HTTP redirect)
      // is the most compatible with wallets that don't follow 3xx on JSON.
      if (route.kind === 'alias') {
        // An alias pointing at another LOCAL alias used to be proxied over HTTP
        // back into this same route, so `a -> b -> a` recursed until the 5s
        // timeout unwound, pinning one request per level — reachable by anyone
        // who knew the address. Local hops are followed in the database with a
        // visited set instead, so only the final off-instance hop is fetched.
        const target = await followLocalAliases(route.redirect, username)
        if (!target) throw new NotFoundError('Alias target is invalid')

        try {
          const body = await fetchDestinationPayRequest(target)
          logger.info({ username, target }, 'LUD16 alias proxied')
          return NextResponse.json(body as LUD06Response)
        } catch (err) {
          logger.warn(
            {
              username,
              target,
              error: err instanceof Error ? err.message : String(err)
            },
            'LUD16 alias fetch failed'
          )
          throw new NotFoundError('Alias target not reachable')
        }
      }

      if (route.kind === 'proxyAlias') {
        const [proxy, listener] = await Promise.all([
          getActiveProxyConfig(),
          getListenerConfig()
        ])
        if (!proxy || !listener.enabled) {
          throw new NotFoundError('Deferred payment proxy is not configured')
        }
        const parsed = parseLightningAddress(route.redirect)
        const [{ host }, apiUrl, addressDomain] = await Promise.all([
          resolvePublicEndpoint(req),
          resolveApiUrl(req),
          resolveAddressDomain(req)
        ])
        // Kept for the *remote* SSRF checks and snapshotted onto the payment.
        // A destination on this instance no longer reaches those checks:
        // `fetchDestinationMetadata` serves it over loopback instead, and loops
        // are handled by cycle detection plus the forwarding hop counter.
        // Both hostnames point back here, so both are blocked.
        const blockedHosts = [host, addressDomain, new URL(apiUrl).hostname]
        if (!parsed) {
          throw new NotFoundError('Proxy target is invalid')
        }
        let remote
        try {
          remote = await fetchDestinationMetadata(route.redirect, {
            blockedHosts
          })
        } catch (err) {
          logger.warn(
            { username, destination: route.redirect, err },
            'LUD16 proxy metadata fetch failed'
          )
          throw new NotFoundError('Proxy target not reachable')
        }
        const range = grossRangeForDestination(
          remote.minSendable,
          remote.maxSendable,
          proxy.row.feeBps
        )
        const callback = `${apiUrl}/api/lud16/${username}/cb`
        const feePercent = (proxy.row.feeBps / 100).toFixed(2)
        const metadata: [string, string][] = [
          ['text/identifier', `${username}@${addressDomain}`],
          [
            'text/plain',
            `Payment to ${route.redirect} via LaWallet proxy (${feePercent}% service fee)`
          ]
        ]
        try {
          const remoteEntries = JSON.parse(remote.metadata) as unknown
          if (Array.isArray(remoteEntries)) {
            for (const entry of remoteEntries) {
              if (
                Array.isArray(entry) &&
                typeof entry[0] === 'string' &&
                entry[0].startsWith('image/') &&
                typeof entry[1] === 'string'
              ) {
                metadata.push([entry[0], entry[1]])
              }
            }
          }
        } catch {
          // Remote metadata images are optional; local identifiers remain valid.
        }

        return NextResponse.json({
          status: 'OK',
          tag: 'payRequest',
          callback,
          ...range,
          metadata: JSON.stringify(metadata),
          commentAllowed: Math.min(
            LUD12_MAX_COMMENT_LENGTH,
            remote.commentAllowed ?? 0
          ),
          ...(proxy.row.receiptPubkey && proxy.receiptPrivateKey
            ? {
                allowsNostr: true,
                nostrPubkey: proxy.row.receiptPubkey
              }
            : {})
        } as LUD06Response)
      }

      // route.kind === 'wallet' — return our own LUD-16 so /cb can mint an
      // invoice through the resolved wallet's driver.
      //
      // `addressDomain` labels the address in the metadata (the `domain` setting
      // — what payer wallets display), but the `callback` is fetched directly by
      // the sender's wallet, so it must point at this instance's API URL (the
      // `endpoint` setting / request host) — NOT the `domain`, which need not
      // serve the API. Mirrors the card `/scan` fix; without it, payments to
      // `user@domain` fail when the domain doesn't serve the API.
      const [addressDomain, zapCapability] = await Promise.all([
        resolveAddressDomain(req),
        getZapReceiptCapability()
      ])
      const callback = `${await resolveApiUrl(req)}/api/lud16/${username}/cb`

      // Embed the user's cached Nostr avatar (kind:0) as a base64 image so payer
      // wallets show it next to the address — the same shape lacrypta.ar serves.
      // Read-only from the local cache (never blocks on a relay); `warm` kicks the
      // profile fetch the first time so the next payRequest can include it.
      // NOTE: the `/cb` route mints with a plain description (no description-hash
      // of this metadata), so enriching it here has no effect on invoice minting.
      const pubkey = lightningAddress.user.pubkey
      const avatarEntry = pubkey
        ? await getLud16AvatarMetadataEntry(pubkey)
        : null
      if (pubkey && !avatarEntry) warmNostrProfileForLud16(pubkey)

      const metadata: [string, string][] = [
        ['text/identifier', `${username}@${addressDomain}`],
        ['text/plain', `Payment to @${username} on ${addressDomain}`],
        ...(avatarEntry ? [avatarEntry] : [])
      ]

      return NextResponse.json({
        status: 'OK',
        tag: 'payRequest',
        callback,
        minSendable: 1000, // 1 satoshi in msats
        maxSendable: 1000000000, // 1,000,000 sats in msats
        metadata: JSON.stringify(metadata),
        // LUD-12: declare the max comment length we accept on the callback.
        // See: https://github.com/lnurl/luds/blob/luds/12.md
        commentAllowed: LUD12_MAX_COMMENT_LENGTH,
        payerData: {
          name: { mandatory: false },
          email: { mandatory: false }
        },
        ...(zapCapability.nip57
          ? {
              allowsNostr: true,
              nostrPubkey: zapCapability.receiptPubkey!
            }
          : {})
      } as LUD06Response)
    }
  ),
  { headers: PUBLIC_READ_CORS_HEADERS }
)
