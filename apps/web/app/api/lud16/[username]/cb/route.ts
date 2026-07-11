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
import { resolveApiUrl } from '@/lib/public-url'
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
import {
  createLncurlRemoteWallet,
  lncurlHealTarget,
} from '@/lib/wallet/lncurl-wallet'
import {
  bindPrimaryAddressToWallet,
  getPrimaryRemoteWalletForUser,
  syncPrimaryRemoteWalletFlag,
} from '@/lib/wallet/primary-wallet'

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

    // Same shape as the metadata route — pull the address's bound wallet and
    // derive DEFAULT_NWC from the account primary address so /cb stays in
    // lockstep with the LUD-16 lookup.
    const lightningAddress = await prisma.lightningAddress.findUnique({
      where: { username },
      include: {
        remoteWallet: { select: { id: true, type: true, config: true, status: true } },
        user: {
          select: {
            id: true,
          },
        },
      },
    })

    if (!lightningAddress) {
      throw new NotFoundError('Lightning address not found')
    }

    const primaryWallet = await getPrimaryRemoteWalletForUser(lightningAddress.user.id)

    const route = resolveWalletRoute({
      mode: lightningAddress.mode,
      redirect: lightningAddress.redirect,
      remoteWallet: lightningAddress.remoteWallet,
      defaultRemoteWallet: primaryWallet,
    })

    // Lazy LNCurl self-heal: an address that can't currently route — no wallet
    // yet (e.g. signup with auto-create off), or a dead disposable wallet —
    // provisions a fresh LNCurl wallet NOW, on the real invoice request, when
    // the operator runs LNCurl + auto-recreate. This is what the metadata route
    // promised when it served a callback for such addresses instead of 404ing.
    let mintRoute = route
    if (route.kind === 'unconfigured') {
      const {
        lncurl_enabled,
        lncurl_auto_create,
        lncurl_auto_recreate,
        lncurl_server_url,
      } = await getSettings([
        'lncurl_enabled',
        'lncurl_auto_create',
        'lncurl_auto_recreate',
        'lncurl_server_url',
      ])
      const heal = lncurlHealTarget(
        {
          mode: lightningAddress.mode,
          boundWallet: lightningAddress.remoteWallet,
          defaultWallet: primaryWallet,
        },
        { lncurl_enabled, lncurl_auto_create, lncurl_auto_recreate },
      )
      if (heal) {
        try {
          const provisioned = await createLncurlRemoteWallet({
            userId: lightningAddress.user.id,
            previousWalletId: heal.previousWalletId ?? undefined,
            revokePrevious: heal.previousWalletId != null,
            serverUrl: lncurl_server_url || undefined,
          })
          let bindingChanged = heal.previousWalletId != null
          // DEFAULT_NWC routes through the primary address's wallet. A
          // CUSTOM_NWC address with no prior wallet to re-point needs an
          // explicit binding to the freshly minted wallet.
          if (lightningAddress.mode === 'DEFAULT_NWC') {
            bindingChanged =
              (await bindPrimaryAddressToWallet(
                lightningAddress.user.id,
                provisioned.id,
              )) != null
          }
          if (
            lightningAddress.mode === 'CUSTOM_NWC' &&
            heal.previousWalletId == null
          ) {
            await prisma.lightningAddress.update({
              where: { username },
              data: { remoteWalletId: provisioned.id },
            })
            if (lightningAddress.isPrimary) {
              await syncPrimaryRemoteWalletFlag(lightningAddress.user.id)
            }
            bindingChanged = true
          }
          eventBus.emit({ type: 'listener:updated', timestamp: Date.now() })
          if (bindingChanged) {
            eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
            eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
          }
          mintRoute = {
            kind: 'wallet',
            walletId: provisioned.id,
            type: provisioned.type,
            config: provisioned.config,
          }
          logger.info(
            { username, walletId: provisioned.id },
            'LNCurl auto-heal provisioned wallet on invoice request',
          )
        } catch (healErr) {
          logger.error(
            { username, err: String(healErr) },
            'LNCurl auto-heal provisioning failed',
          )
          throw new ServiceUnavailableError('Wallet is currently unavailable')
        }
      }
    }

    if (mintRoute.kind !== 'wallet') {
      logger.info(
        { username, mode: lightningAddress.mode, reason: mintRoute.kind },
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
      const { driver, config } = driverForWallet({ type: mintRoute.type, config: mintRoute.config })
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
        const provider = (mintRoute.config as { provider?: string } | null)?.provider
        if (provider === 'lncurl') {
          const { lncurl_auto_recreate, lncurl_server_url } = await getSettings([
            'lncurl_auto_recreate',
            'lncurl_server_url',
          ])
          // The dead wallet is the address's bound wallet (CUSTOM_NWC) or the
          // wallet linked through the user's primary address (DEFAULT_NWC).
          const deadWalletId =
            lightningAddress.remoteWallet?.id ??
            primaryWallet?.id ??
            null

          if (lncurl_auto_recreate === 'true' && deadWalletId) {
            try {
              const replacement = await createLncurlRemoteWallet({
                userId: lightningAddress.user.id,
                previousWalletId: deadWalletId,
                revokePrevious: true,
                serverUrl: lncurl_server_url || undefined,
              })
              eventBus.emit({ type: 'listener:updated', timestamp: Date.now() })
              eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
              eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
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
            logger.error({ username, walletType: mintRoute.type, err: String(err) }, 'LUD16 invoice mint failed')
            throw new ServiceUnavailableError('Wallet is currently unavailable')
          }
        } else {
          logger.error({ username, walletType: mintRoute.type, err: String(err) }, 'LUD16 invoice mint failed')
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

    // Build LUD-21 verify URL. Polled directly by the sender's wallet, so it
    // must use this instance's API URL (the `endpoint` setting / request host),
    // not the public address `domain` — same reason as the `callback` above.
    const verify = `${await resolveApiUrl(req)}/api/lud16/${username}/verify/${paymentHash}`

    const response: LUD06CallbackSuccess = {
      pr,
      routes: [],
      verify,
    }

    return NextResponse.json(response)
  }
)
