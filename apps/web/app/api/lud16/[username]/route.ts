import { LUD06Response } from '@/types/lnurl'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { lud16UsernameParam, LUD12_MAX_COMMENT_LENGTH } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { resolvePublicEndpoint } from '@/lib/public-url'
import {
  parseLightningAddress,
  resolvePaymentRoute,
} from '@/lib/wallet/resolve-payment-route'

/** Abort the remote LUD-16 fetch for ALIAS mode after this many ms. */
const ALIAS_FETCH_TIMEOUT_MS = 5000

export const GET = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ username: string }> }) => {
    const { username: _username } = validateParams(await params, lud16UsernameParam)
    const username = _username.trim().toLowerCase()

    logger.info({ username }, 'LUD16 lookup request')

    // Load the address along with every piece resolvePaymentRoute needs: its
    // own linked NWCConnection (CUSTOM_NWC), the owner's primary connection
    // (DEFAULT_NWC), and the legacy `user.nwc` fallback for un-migrated
    // accounts. One query, no N+1.
    const lightningAddress = await prisma.lightningAddress.findUnique({
      where: { username },
      include: {
        nwcConnection: { select: { connectionString: true } },
        user: {
          select: {
            id: true,
            nwc: true,
            nwcConnections: {
              where: { isPrimary: true },
              select: { connectionString: true },
              take: 1,
            },
          },
        },
      },
    })

    if (!lightningAddress) {
      throw new NotFoundError('Lightning address not found')
    }

    const route = resolvePaymentRoute({
      mode: lightningAddress.mode,
      redirect: lightningAddress.redirect,
      nwcConnection: lightningAddress.nwcConnection,
      primaryNwcConnection: lightningAddress.user.nwcConnections[0] ?? null,
      userNwc: lightningAddress.user.nwc,
    })

    // IDLE (disabled by the owner) and unconfigured (missing connection /
    // missing redirect) both look the same to the caller: no LNURL here.
    if (route.kind === 'idle' || route.kind === 'unconfigured') {
      logger.info(
        { username, mode: lightningAddress.mode, reason: route.kind },
        'LUD16 lookup rejected',
      )
      throw new NotFoundError('User not configured for payments')
    }

    // ALIAS: proxy the remote address's LUD-16 response verbatim. We return
    // the remote's `callback` / `verify` URLs as-is, so the sender's wallet
    // will POST directly to the aliased server on the next step — our /cb
    // route is never hit for alias addresses. Proxying (vs. HTTP redirect)
    // is the most compatible with wallets that don't follow 3xx on JSON.
    if (route.kind === 'alias') {
      const parsed = parseLightningAddress(route.redirect)
      if (!parsed) {
        logger.warn({ username, redirect: route.redirect }, 'LUD16 alias redirect malformed')
        throw new NotFoundError('Alias target is invalid')
      }

      const remoteUrl = `https://${parsed.host}/.well-known/lnurlp/${parsed.user}`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), ALIAS_FETCH_TIMEOUT_MS)
      try {
        const remote = await fetch(remoteUrl, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!remote.ok) {
          logger.warn(
            { username, remoteUrl, status: remote.status },
            'LUD16 alias fetch returned non-2xx',
          )
          throw new NotFoundError('Alias target not reachable')
        }
        const body = (await remote.json()) as LUD06Response
        logger.info({ username, remoteUrl }, 'LUD16 alias proxied')
        return NextResponse.json(body)
      } catch (err) {
        if (err instanceof NotFoundError) throw err
        logger.warn(
          { username, remoteUrl, error: err instanceof Error ? err.message : String(err) },
          'LUD16 alias fetch failed',
        )
        throw new NotFoundError('Alias target not reachable')
      } finally {
        clearTimeout(timer)
      }
    }

    // route.kind === 'nwc' — return our own LUD-16 so /cb can mint an invoice.
    const { host, url } = await resolvePublicEndpoint(req)
    const callback = `${url}/api/lud16/${username}/cb`

    return NextResponse.json({
      status: 'OK',
      tag: 'payRequest',
      callback,
      minSendable: 1000, // 1 satoshi in msats
      maxSendable: 1000000000, // 1,000,000 sats in msats
      metadata: JSON.stringify([
        ['text/plain', `Payment to @${username} on ${host}`]
      ]),
      // LUD-12: declare the max comment length we accept on the callback.
      // See: https://github.com/lnurl/luds/blob/luds/12.md
      commentAllowed: LUD12_MAX_COMMENT_LENGTH,
      payerData: {
        name: { mandatory: false },
        email: { mandatory: false }
      }
    } as LUD06Response)
  }
)
