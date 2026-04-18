import { NextRequest, NextResponse } from 'next/server'
import { LUD06CallbackSuccess } from '@/types/lnurl'
import { LN, SATS } from '@getalby/sdk'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  InternalServerError,
  NotFoundError,
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
import { resolvePaymentRoute } from '@/lib/wallet/resolve-payment-route'
import { eventBus } from '@/lib/events/event-bus'

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

    // Same shape as the metadata route — pull every piece resolvePaymentRoute
    // needs so /cb stays in lockstep with the LUD-16 lookup. Wallets only hit
    // /cb after our metadata route promised them a callback URL, so we
    // expect the resolved route to be `nwc`. ALIAS addresses returned the
    // remote callback URL during step one, so /cb here is unreachable for
    // them — but if a stale link or hand-crafted request still lands here we
    // surface a clean 404 instead of crashing.
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

    if (route.kind !== 'nwc') {
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

    // Generate invoice via NWC — connection string comes from the resolver,
    // so CUSTOM_NWC uses the address's linked connection and DEFAULT_NWC
    // uses the user's primary (or legacy `User.nwc` fallback).
    const ln = new LN(route.connectionString)
    const amountSats = Math.floor(Number(amount) / 1000)
    const invoiceObj = await ln.requestPayment(SATS(amountSats), {
      description,
    })

    const pr = invoiceObj.invoice?.paymentRequest
    if (!pr) {
      throw new InternalServerError('Failed to generate invoice')
    }

    // Extract payment hash — required to build the LUD-21 verify URL
    const paymentHash = extractPaymentHash(pr)
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
