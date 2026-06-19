import { NextRequest, NextResponse } from 'next/server'
import { LUD06CallbackSuccess } from '@/types/lnurl'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  InternalServerError,
  NotFoundError,
  ServiceUnavailableError,
} from '@/types/server/errors'
import {
  lud16CallbackQuerySchema,
  LUD12_MAX_COMMENT_LENGTH,
} from '@/lib/validation/schemas'
import { validateQuery } from '@/lib/validation/middleware'
import { resolvePublicEndpoint } from '@/lib/public-url'
import {
  extractPaymentHash,
  extractExpiry,
  type InvoiceMetadata,
} from '@/lib/invoice-utils'
import type { Prisma } from '@/lib/generated/prisma'
import { logger } from '@/lib/logger'
import { resolveWalletRoute } from '@/lib/wallet/resolve-payment-route'
import { DriverError, driverForWallet } from '@/lib/wallet/drivers'
import { eventBus } from '@/lib/events/event-bus'
import { getSettings } from '@/lib/settings'
import { createLncurlRemoteWallet } from '@/lib/wallet/lncurl-wallet'

export const GET = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ username: string }> }) => {
    const { username: _username } = await params
    const username = _username.trim().toLowerCase()
    const { amount, comment } = validateQuery(req.url, lud16CallbackQuerySchema)

    // LUD-12: sanitize the comment (defense in depth — schema enforces max length).
    // Strip control chars that some wallets might refuse in bolt11 descriptions.
    const sanitizedComment = comment
      ?.trim()
      .replace(/[\x00-\x1f\x7f]/g, '')
      .slice(0, LUD12_MAX_COMMENT_LENGTH)
      || undefined

    // Same shape as the metadata route — pull every piece resolveWalletRoute
    // needs so /cb stays in lockstep with the LUD-16 lookup. Wallets only hit
    // /cb after our metadata route promised them a callback URL, so we
    // expect the resolved route to be `wallet`. ALIAS addresses returned the
    // remote callback URL during step one, so /cb here is unreachable for
    // them — but if a stale link or hand-crafted request still lands here we
    // surface a clean 404 instead of crashing.
    //
    // RemoteWallet is the source of truth (#234): the address's bound wallet
    // (CUSTOM) or the user's default wallet (DEFAULT). Legacy NWCConnection /
    // User.nwc remain as fallbacks for accounts not yet migrated.
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

    if (route.kind !== 'wallet') {
      logger.info(
        { username, mode: lightningAddress.mode, reason: route.kind },
        'LUD16 callback rejected',
      )
      throw new NotFoundError('User not configured for payments')
    }

    // Build the description — LUD-12 says the comment should be included
    // so the sender's note appears in the recipient's wallet history.
    const baseDescription = `Payment to @${username}`
    const description = sanitizedComment
      ? `${baseDescription}: ${sanitizedComment}`
      : baseDescription

    // Mint the invoice through the driver registry. The route carries a
    // `{ type, config }` resolved from the RemoteWallet (or synthesised from
    // a legacy NWC connection string), so this is wallet-type-agnostic.
    const amountSats = Math.floor(Number(amount) / 1000)
    let made
    try {
      const { driver, config } = driverForWallet({ type: route.type, config: route.config })
      made = await driver.makeInvoice(config, { amountSats, description })
    } catch (err) {
      // Driver/transport failures (relay down, wallet rejected make_invoice,
      // corrupt config) shouldn't surface as a 500 — they're an upstream
      // dependency being unavailable, not a bug in our handler.
      if (err instanceof DriverError) {
        // Self-heal: LNCurl wallets are ephemeral/custodial, so a dead one is
        // expected. When the routed wallet is an LNCurl wallet and auto-recreate
        // is on, re-provision a fresh LNCurl wallet (revoking the dead one),
        // re-point the user's bindings, and retry the mint once.
        const provider = (route.config as { provider?: string } | null)?.provider
        if (provider === 'lncurl') {
          const { lncurl_auto_recreate, lncurl_server_url } = await getSettings([
            'lncurl_auto_recreate',
            'lncurl_server_url',
          ])
          // The dead wallet is the address's bound wallet (CUSTOM_NWC) or the
          // user's default wallet (DEFAULT_NWC).
          const deadWalletId =
            lightningAddress.remoteWallet?.id ??
            lightningAddress.user.remoteWallets[0]?.id ??
            null

          if (lncurl_auto_recreate === 'true' && deadWalletId) {
            try {
              const replacement = await createLncurlRemoteWallet({
                userId: lightningAddress.user.id,
                previousWalletId: deadWalletId,
                revokePrevious: true,
                serverUrl: lncurl_server_url || undefined,
              })
              const { driver, config } = driverForWallet({
                type: replacement.type,
                config: replacement.config,
              })
              made = await driver.makeInvoice(config, { amountSats, description })
            } catch (recoveryErr) {
              logger.error(
                { username, err: String(recoveryErr) },
                'LNCurl auto-recreate recovery failed',
              )
              throw new ServiceUnavailableError('Wallet is currently unavailable')
            }
          } else {
            logger.error({ username, walletType: route.type, err: String(err) }, 'LUD16 invoice mint failed')
            throw new ServiceUnavailableError('Wallet is currently unavailable')
          }
        } else {
          logger.error({ username, walletType: route.type, err: String(err) }, 'LUD16 invoice mint failed')
          throw new ServiceUnavailableError('Wallet is currently unavailable')
        }
      } else {
        throw err
      }
    }

    const pr = made.bolt11
    if (!pr) {
      throw new InternalServerError('Failed to generate invoice')
    }

    // Prefer the wallet-reported payment hash; fall back to parsing the
    // bolt11 so the LUD-21 verify URL is always derivable.
    const paymentHash = made.paymentHash || extractPaymentHash(pr)
    if (!paymentHash) {
      logger.error({ username }, 'Failed to extract payment hash from bolt11')
      throw new InternalServerError('Invalid invoice returned from wallet')
    }

    // Persist invoice to DB (required for LUD-21 verification)
    // Use upsert to gracefully handle duplicate payment hashes (unique constraint)
    const metadata: InvoiceMetadata = {
      username,
      ...(sanitizedComment ? { comment: sanitizedComment } : {}),
    }
    // Prisma's JSON column accepts plain objects; cast through its branded type.
    const metadataJson = metadata as unknown as Prisma.InputJsonValue
    const invoice = await prisma.invoice.upsert({
      where: { paymentHash },
      create: {
        bolt11: pr,
        paymentHash,
        amountSats,
        description,
        purpose: 'LUD16_PAYMENT',
        status: 'PENDING',
        userId: lightningAddress.user.id,
        expiresAt: extractExpiry(pr),
        metadata: metadataJson,
      },
      update: {
        // If somehow re-issued with same hash, just refresh the bolt11/expiry
        bolt11: pr,
        description,
        expiresAt: extractExpiry(pr),
        metadata: metadataJson,
      },
    })

    logger.info(
      {
        invoiceId: invoice.id,
        username,
        paymentHash,
        amountSats,
        hasComment: Boolean(sanitizedComment),
      },
      'LUD-16 invoice created'
    )

    // Fan out to any SSE-connected clients (e.g. the owner's
    // /admin/addresses/[username] page) so their invoice feed refetches
    // without a manual refresh — same event used by `/api/invoices` so
    // the dashboard / wallet surfaces stay in sync too.
    eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })

    // Build LUD-21 verify URL
    const { url } = await resolvePublicEndpoint(req)
    const verify = `${url}/api/lud16/${username}/verify/${paymentHash}`

    const response: LUD06CallbackSuccess = {
      pr,
      routes: [],
      verify,
    }

    return NextResponse.json(response)
  }
)
