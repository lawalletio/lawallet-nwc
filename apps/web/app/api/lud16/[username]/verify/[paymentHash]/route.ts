import { after, NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import type { LUD21VerifySuccess, LUD21VerifyError } from '@/types/lnurl'
import { settleInvoiceFromWallet } from '@/lib/invoices/settle-from-wallet'
import { publishInvoiceZapReceipt } from '@/lib/nostr/zap-receipts'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { shouldLookupInvoice } from '@/lib/invoices/lookup-throttle'
import {
  PUBLIC_READ_CORS_HEADERS,
  publicReadOptions,
  withPublicReadCors
} from '@/lib/public-cors'

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
export const OPTIONS = publicReadOptions

export const GET = withErrorHandling(
  withPublicReadCors(
    async (
      req: NextRequest,
      {
        params
      }: {
        params: Promise<{ username: string; paymentHash: string }>
      }
    ) => {
      await rateLimit(req, RateLimitPresets.lud16)

      const { username: rawUsername, paymentHash: rawHash } = await params
      const username = rawUsername.trim().toLowerCase()
      const paymentHash = rawHash.trim().toLowerCase()

      if (!/^[a-f0-9]{64}$/.test(paymentHash)) {
        const error: LUD21VerifyError = {
          status: 'ERROR',
          reason: 'Invalid payment hash'
        }
        return NextResponse.json(error, { status: 400 })
      }

      // Ownership is part of the WHERE (a hash belonging to another account,
      // or to an address this user doesn't hold, simply isn't found), and only
      // the invoice's own columns load: this is one statement. Most polls stop
      // at paid / expired / throttled, so the wallet, address and proxy rows
      // (one round-trip per nesting level in Prisma 7) load only when needed.
      const invoice = await prisma.invoice.findUnique({
        where: {
          paymentHash,
          user: { lightningAddresses: { some: { username } } }
        },
        select: {
          id: true,
          bolt11: true,
          status: true,
          preimage: true,
          expiresAt: true,
          zapRequest: true
        }
      })

      if (!invoice) {
        throw new NotFoundError('Invoice not found')
      }

      // The authenticated listener can confirm settlement even when a wallet
      // notification omits the optional preimage. LUD-21's preimage is nullable,
      // so the persisted source status remains authoritative in either case.
      if (invoice.status === 'PAID') {
        if (invoice.zapRequest) {
          const { proxyPayment } = await loadSettlable(invoice.id, username)
          if (!proxyPayment) after(() => publishInvoiceZapReceipt(invoice.id))
        }
        const response: LUD21VerifySuccess = {
          status: 'OK',
          settled: true,
          preimage: invoice.preimage ?? null,
          pr: invoice.bolt11
        }
        return NextResponse.json(response)
      }

      // If expired, report as not settled (still returns pr for client to know)
      if (invoice.expiresAt < new Date()) {
        const response: LUD21VerifySuccess = {
          status: 'OK',
          settled: false,
          preimage: null,
          pr: invoice.bolt11
        }
        return NextResponse.json(response)
      }

      if (!shouldLookupInvoice(paymentHash)) {
        const response: LUD21VerifySuccess = {
          status: 'OK',
          settled: false,
          preimage: null,
          pr: invoice.bolt11
        }
        return NextResponse.json(response)
      }

      // Ask the wallet that minted this invoice whether it settled. Persisting
      // the answer means subsequent polls skip the NWC round-trip. Lookup and
      // settlement are shared with the NIP-57 sweep so the two can't disagree
      // about what counts as paid.
      const settlable = await loadSettlable(invoice.id, username)
      const settlement = await settleInvoiceFromWallet(settlable, {
        source: 'lud21_verify',
        address: settlable.user?.lightningAddresses[0] ?? null,
        schedule: task => after(task)
      })

      // Both `pending` (wallet says unpaid) and `unavailable` (we couldn't ask)
      // are reported as unsettled — LUD-21 has no third state, and the client
      // simply polls again.
      const response: LUD21VerifySuccess =
        settlement.outcome === 'settled'
          ? {
              status: 'OK',
              settled: true,
              preimage: settlement.preimage,
              pr: invoice.bolt11
            }
          : {
              status: 'OK',
              settled: false,
              preimage: null,
              pr: invoice.bolt11
            }
      return NextResponse.json(response)
    }
  ),
  { headers: PUBLIC_READ_CORS_HEADERS }
)

/** Everything `settleInvoiceFromWallet` reads, plus the address it may route by. */
async function loadSettlable(id: string, username: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      bolt11: true,
      paymentHash: true,
      amountSats: true,
      description: true,
      purpose: true,
      status: true,
      preimage: true,
      metadata: true,
      userId: true,
      expiresAt: true,
      paidAt: true,
      createdAt: true,
      zapRequest: true,
      proxyPayment: { select: { id: true } },
      remoteWallet: {
        select: { id: true, type: true, config: true, status: true }
      },
      user: {
        select: {
          lightningAddresses: {
            where: { username },
            select: {
              mode: true,
              redirect: true,
              remoteWallet: {
                select: { id: true, type: true, config: true, status: true }
              }
            },
            take: 1
          }
        }
      }
    }
  })
  // Only if the row vanished (account deleted) since the first read.
  if (!invoice) throw new NotFoundError('Invoice not found')
  return invoice
}
