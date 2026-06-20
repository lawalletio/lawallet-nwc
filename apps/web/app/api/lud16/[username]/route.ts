import { LUD06Response } from '@/types/lnurl'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { lud16UsernameParam, LUD12_MAX_COMMENT_LENGTH } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { resolvePublicEndpoint } from '@/lib/public-url'
import { LNURL_VERIFY_USERNAME } from '@/lib/domain-onboarding'
import {
  parseLightningAddress,
  resolveWalletRoute,
} from '@/lib/wallet/resolve-payment-route'
import { getSettings } from '@/lib/settings'
import { lncurlHealTarget } from '@/lib/wallet/lncurl-wallet'

/** Abort the remote LUD-16 fetch for ALIAS mode after this many ms. */
const ALIAS_FETCH_TIMEOUT_MS = 5000

export const GET = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ username: string }> }) => {
    const { username: _username } = validateParams(await params, lud16UsernameParam)
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
          ['text/plain', `LaWallet LNURL verification for ${host}: ${probe}`],
        ]),
      } as LUD06Response & { status: 'OK' })
    }

    // Load the address along with every piece resolveWalletRoute needs: its
    // bound RemoteWallet (CUSTOM) and the owner's default RemoteWallet
    // (DEFAULT), plus the legacy NWCConnection / `user.nwc` fallbacks for
    // un-migrated accounts. One query, no N+1. Must stay in lockstep with
    // the /cb route's query so metadata and callback can't disagree.
    const lightningAddress = await prisma.lightningAddress.findUnique({
      where: { username },
      include: {
        remoteWallet: { select: { id: true, type: true, config: true, status: true } },
        user: {
          select: {
            id: true,
            remoteWallets: {
              where: { isDefault: true },
              select: { id: true, type: true, config: true, status: true },
              take: 1,
            },
          },
        },
      },
    })

    if (!lightningAddress) {
      throw new NotFoundError('Lightning address not found')
    }

    const route = resolveWalletRoute({
      mode: lightningAddress.mode,
      redirect: lightningAddress.redirect,
      remoteWallet: lightningAddress.remoteWallet,
      defaultRemoteWallet: lightningAddress.user.remoteWallets[0] ?? null,
    })

    // IDLE (disabled by the owner) is always a dead end — no LNURL here.
    if (route.kind === 'idle') {
      logger.info(
        { username, mode: lightningAddress.mode, reason: route.kind },
        'LUD16 lookup rejected',
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
        'lncurl_auto_recreate',
      ])
      const heal = lncurlHealTarget(
        {
          mode: lightningAddress.mode,
          boundWallet: lightningAddress.remoteWallet,
          defaultWallet: lightningAddress.user.remoteWallets[0] ?? null,
        },
        settings,
      )
      if (!heal) {
        logger.info(
          { username, mode: lightningAddress.mode, reason: route.kind },
          'LUD16 lookup rejected',
        )
        throw new NotFoundError('User not configured for payments')
      }
      logger.info(
        { username, mode: lightningAddress.mode },
        'LUD16 lookup served via LNCurl auto-heal (deferred provisioning)',
      )
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

    // route.kind === 'wallet' — return our own LUD-16 so /cb can mint an
    // invoice through the resolved wallet's driver.
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
