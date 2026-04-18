import { NextRequest, NextResponse } from 'next/server'
import { NWCClient } from '@getalby/sdk'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import type { LUD21VerifySuccess, LUD21VerifyError } from '@/types/lnurl'
import { eventBus } from '@/lib/events/event-bus'

/**
 * LUD-21 (LNURL verify) endpoint.
 *
 * Allows a sender to verify whether a LUD-16 invoice has been paid without
 * needing to decode the bolt11 themselves. Returns the preimage when settled.
 *
 * Spec: https://github.com/lnurl/luds/blob/luds/21.md
 *
 * Response (success):
 *   { status: "OK", settled: boolean, preimage: string | null, pr: string }
 * Response (error):
 *   { status: "ERROR", reason: string }
 */
export const GET = withErrorHandling(
  async (
    _req: NextRequest,
    {
      params,
    }: {
      params: Promise<{ username: string; paymentHash: string }>
    }
  ) => {
    const { username: rawUsername, paymentHash: rawHash } = await params
    const username = rawUsername.trim().toLowerCase()
    const paymentHash = rawHash.trim().toLowerCase()

    if (!/^[a-f0-9]{64}$/.test(paymentHash)) {
      const error: LUD21VerifyError = {
        status: 'ERROR',
        reason: 'Invalid payment hash',
      }
      return NextResponse.json(error, { status: 400 })
    }

    // Find the stored invoice. We need to confirm the payment hash actually
    // belongs to the lightning address being queried — pull the user's
    // addresses scoped to the matching username (cheap by-PK lookup).
    const invoice = await prisma.invoice.findUnique({
      where: { paymentHash },
      include: {
        user: {
          select: {
            id: true,
            nwc: true,
            lightningAddresses: {
              where: { username },
              select: { username: true },
              take: 1,
            },
          },
        },
      },
    })

    if (!invoice || !invoice.user) {
      throw new NotFoundError('Invoice not found')
    }

    // Ensure the payment hash belongs to this username (prevent cross-user lookups)
    if (invoice.user.lightningAddresses[0]?.username !== username) {
      throw new NotFoundError('Invoice not found for this username')
    }

    // If already settled, return cached preimage
    if (invoice.status === 'PAID' && invoice.preimage) {
      const response: LUD21VerifySuccess = {
        status: 'OK',
        settled: true,
        preimage: invoice.preimage,
        pr: invoice.bolt11,
      }
      return NextResponse.json(response)
    }

    // If expired, report as not settled (still returns pr for client to know)
    if (invoice.expiresAt < new Date()) {
      const response: LUD21VerifySuccess = {
        status: 'OK',
        settled: false,
        preimage: null,
        pr: invoice.bolt11,
      }
      return NextResponse.json(response)
    }

    // Query NWC to check current status
    if (!invoice.user.nwc) {
      const response: LUD21VerifySuccess = {
        status: 'OK',
        settled: false,
        preimage: null,
        pr: invoice.bolt11,
      }
      return NextResponse.json(response)
    }

    let nwcClient: NWCClient | null = null
    try {
      nwcClient = new NWCClient({ nostrWalletConnectUrl: invoice.user.nwc })
      const tx = await nwcClient.lookupInvoice({ payment_hash: paymentHash })

      const settled = tx.state === 'settled'
      const preimage = settled && tx.preimage ? tx.preimage : null

      // Persist settled state so subsequent calls avoid the NWC round-trip
      if (settled && preimage && invoice.status !== 'PAID') {
        await prisma.invoice.update({
          where: { paymentHash },
          data: {
            status: 'PAID',
            preimage,
            paidAt: new Date(tx.settled_at ? tx.settled_at * 1000 : Date.now()),
          },
        })
        // Broadcast the PENDING → PAID flip so the owner's address invoice
        // feed flips without requiring a manual refresh. Only emit on the
        // transition (we're already inside the `status !== 'PAID'` guard)
        // to avoid spamming the bus on every verify poll of a settled tx.
        eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })
      }

      const response: LUD21VerifySuccess = {
        status: 'OK',
        settled,
        preimage,
        pr: invoice.bolt11,
      }
      return NextResponse.json(response)
    } catch (error) {
      logger.warn(
        { paymentHash, error: error instanceof Error ? error.message : String(error) },
        'NWC lookup_invoice failed'
      )
      // On NWC failure, return unsettled (client can retry later)
      const response: LUD21VerifySuccess = {
        status: 'OK',
        settled: false,
        preimage: null,
        pr: invoice.bolt11,
      }
      return NextResponse.json(response)
    } finally {
      try {
        nwcClient?.close()
      } catch {
        // ignore close errors
      }
    }
  }
)
