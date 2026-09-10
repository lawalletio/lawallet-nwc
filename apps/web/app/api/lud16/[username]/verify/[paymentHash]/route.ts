import { after, NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import type { LUD21VerifySuccess, LUD21VerifyError } from '@/types/lnurl'
import { settleInvoiceFromWallet } from '@/lib/invoices/settle-from-wallet'
import { publishInvoiceZapReceipt } from '@/lib/nostr/zap-receipts'
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
      _req: NextRequest,
      {
        params
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
          reason: 'Invalid payment hash'
        }
        return NextResponse.json(error, { status: 400 })
      }

      // Find the stored invoice. We need to confirm the payment hash actually
      // belongs to the lightning address being queried — pull the user's
      // addresses scoped to the matching username (cheap by-PK lookup).
      const invoice = await prisma.invoice.findUnique({
        where: { paymentHash },
        include: {
          proxyPayment: {
            select: { id: true, status: true }
          },
          remoteWallet: {
            select: { id: true, type: true, config: true, status: true }
          },
          user: {
            select: {
              id: true,
              lightningAddresses: {
                where: { username },
                include: {
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

      if (!invoice || !invoice.user) {
        throw new NotFoundError('Invoice not found')
      }

      // Ensure the payment hash belongs to this username (prevent cross-user
      // lookups). The include filters on `username`, so a hash belonging to
      // someone else comes back with no address at all.
      const address = invoice.user.lightningAddresses[0]
      if (!address || address.username !== username) {
        throw new NotFoundError('Invoice not found for this username')
      }

      // The authenticated listener can confirm settlement even when a wallet
      // notification omits the optional preimage. LUD-21's preimage is nullable,
      // so the persisted source status remains authoritative in either case.
      if (invoice.status === 'PAID') {
        if (!invoice.proxyPayment && invoice.zapRequest) {
          after(() => publishInvoiceZapReceipt(invoice.id))
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

      // Ask the wallet that minted this invoice whether it settled. Persisting
      // the answer means subsequent polls skip the NWC round-trip. Lookup and
      // settlement are shared with the NIP-57 sweep so the two can't disagree
      // about what counts as paid.
      const settlement = await settleInvoiceFromWallet(invoice, {
        source: 'lud21_verify',
        address,
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
