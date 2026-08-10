import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { requireUserAddressRegistration } from '@/lib/auth/paid-registration-guard'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { claimInvoiceSchema } from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'
import { dispatchHookAndForget } from '@/plugins/index'
import {
  ActivityEvent,
  invoiceLogMetadata,
  logActivity
} from '@/lib/activity-log'
import { resolveDefaultAddressRouting } from '@/lib/wallet/default-address-mode'
import {
  findInitialPrimaryWalletCandidate,
  getPrimaryRemoteWalletForUser,
  syncPrimaryRemoteWalletFlag
} from '@/lib/wallet/primary-wallet'
import type { InvoiceMetadata } from '@/lib/invoice-utils'

/**
 * Verifies that SHA256(preimage) === paymentHash.
 */
function verifyPreimage(preimage: string, paymentHash: string): boolean {
  const preimageBytes = Buffer.from(preimage, 'hex')
  const hash = createHash('sha256').update(preimageBytes).digest('hex')
  return hash === paymentHash
}

export const POST = withErrorHandling(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await checkRequestLimits(request, 'json')
    const { pubkey, role } = await authenticate(request)
    const { id } = await params
    const body = await validateBody(request, claimInvoiceSchema)

    // Resolve the user (any linked pubkey maps to the owning account)
    const user = await resolveAccountByPubkey(pubkey)
    if (!user) {
      throw new ValidationError('User not found')
    }

    // Find the invoice
    const invoice = await prisma.invoice.findUnique({ where: { id } })
    if (!invoice) {
      throw new NotFoundError('Invoice not found')
    }

    // Verify ownership
    if (invoice.userId !== user.id) {
      throw new AuthorizationError('Not authorized to claim this invoice')
    }

    // Check status
    if (invoice.status === 'PAID') {
      throw new ConflictError('Invoice has already been claimed')
    }
    if (invoice.status === 'EXPIRED' || invoice.expiresAt < new Date()) {
      // Opportunistic sweeper: if the row is still PENDING but past its
      // expiry, flip it now so the admin log reflects reality and the
      // invoices list stops showing it as "pending payment".
      if (invoice.status === 'PENDING') {
        try {
          // Conditional on PENDING: `invoice` is a stale read, so a concurrent
          // claim may have already committed PAID and created the address
          // between it and this write. An unconditional update would clobber
          // that to EXPIRED, leaving a paid invoice the user can't see.
          await prisma.invoice.updateMany({
            where: { id, status: 'PENDING' },
            data: { status: 'EXPIRED' }
          })
        } catch {
          // Best-effort sweep — never block the expiry response on it.
        }
        logActivity.fireAndForget({
          category: 'INVOICE',
          event: ActivityEvent.INVOICE_EXPIRED,
          level: 'WARN',
          message: `Invoice expired before claim (${invoice.amountSats} sats)`,
          userId: user.id,
          metadata: invoiceLogMetadata({ ...invoice, status: 'EXPIRED' })
        })
      }
      throw new ValidationError('Invoice has expired')
    }

    const createsAddress =
      invoice.purpose === 'REGISTRATION' || invoice.purpose === 'WALLET_ADDRESS'

    if (createsAddress) {
      await requireUserAddressRegistration(role)
    }

    // Verify preimage. A valid preimage proves the bolt11 was paid; the
    // invoice itself was only minted while paid registration was enabled.
    // We intentionally do NOT re-check `registration_ln_enabled` here — if
    // an operator toggles paid mode off after the invoice was issued, the
    // user already paid and is entitled to their address.
    if (!verifyPreimage(body.preimage, invoice.paymentHash)) {
      throw new ValidationError(
        'Invalid preimage — does not match payment hash'
      )
    }

    // Execute purpose-specific action
    let result: Record<string, unknown> = { success: true }

    if (createsAddress) {
      const metadata = invoice.metadata as InvoiceMetadata | null
      const username = metadata?.username
      if (!username) {
        throw new ValidationError('Invoice metadata missing username')
      }

      // Re-check availability — the username may have been taken
      // between invoice mint and claim.
      const existing = await prisma.lightningAddress.findUnique({
        where: { username }
      })
      if (existing) {
        throw new ConflictError('Username was taken while payment was pending')
      }

      // Read-only routing defaults for a secondary add — computed outside the
      // transaction since they don't take a tx client.
      const secondaryRouting =
        invoice.purpose === 'WALLET_ADDRESS'
          ? await resolveDefaultAddressRouting(user.id)
          : null

      // The PAID flip and the address creation commit or roll back TOGETHER:
      // a failed insert (e.g. the username was taken concurrently) must never
      // strand a paid invoice with no address — the user paid and is entitled
      // to retry. The conditional update also closes the double-claim race:
      // only one concurrent claim flips PENDING → PAID and wins.
      try {
        await prisma.$transaction(async tx => {
          const claimed = await tx.invoice.updateMany({
            where: { id, status: 'PENDING' },
            data: {
              status: 'PAID',
              preimage: body.preimage,
              paidAt: new Date()
            }
          })
          if (claimed.count === 0) {
            throw new ConflictError('Invoice has already been claimed')
          }

          if (invoice.purpose === 'REGISTRATION') {
            const currentPrimaryWallet = await getPrimaryRemoteWalletForUser(
              user.id,
              tx
            )
            const candidate =
              currentPrimaryWallet ??
              (await findInitialPrimaryWalletCandidate(user.id, tx))

            // Primary swap: delete the existing primary first so the
            // partial-unique index on (userId) WHERE isPrimary=true
            // doesn't conflict, then insert the new primary row.
            const existingPrimary = await tx.lightningAddress.findFirst({
              where: { userId: user.id, isPrimary: true }
            })
            if (existingPrimary) {
              await tx.lightningAddress.delete({
                where: { username: existingPrimary.username }
              })
            }
            await tx.lightningAddress.create({
              data: {
                username,
                userId: user.id,
                isPrimary: true,
                mode: candidate ? 'CUSTOM_NWC' : 'IDLE',
                remoteWalletId: candidate?.id ?? null
              }
            })
            await syncPrimaryRemoteWalletFlag(user.id, tx)
          } else {
            // Secondary add: never touches the existing primary.
            await tx.lightningAddress.create({
              data: {
                username,
                userId: user.id,
                isPrimary: false,
                ...secondaryRouting
              }
            })
          }
        })
      } catch (error) {
        // Concurrent claim created the same username after our pre-check —
        // the unique index is the real guard. The invoice flip rolled back,
        // so report the conflict (not a paid-but-addressless 500).
        if ((error as { code?: string }).code === 'P2002') {
          throw new ConflictError(
            'Username was taken while payment was pending'
          )
        }
        throw error
      }

      const { domain } = await getSettings(['domain'])
      result = {
        success: true,
        lightningAddress: `${username}@${domain}`,
        username
      }
    } else {
      // Non-address purposes: conditional flip only — same double-claim guard.
      const claimed = await prisma.invoice.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'PAID',
          preimage: body.preimage,
          paidAt: new Date()
        }
      })
      if (claimed.count === 0) {
        throw new ConflictError('Invoice has already been claimed')
      }
    }

    eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })
    if (createsAddress) {
      eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
      // The user's primary lightning-address just got set — bump
      // users:updated so /api/users/me consumers (admin "claim your first
      // address" banner, profile cards, etc.) pick up the new state.
      eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
    }

    logActivity.fireAndForget({
      category: 'INVOICE',
      event: ActivityEvent.INVOICE_PAID,
      message: `Invoice paid (${invoice.amountSats} sats, ${invoice.purpose})`,
      userId: user.id,
      // Reflect the post-update state so the log row is an accurate snapshot
      // of the invoice at the moment it flipped to PAID — `invoice` was
      // fetched pre-update and still has status=PENDING / paidAt=null.
      metadata: invoiceLogMetadata({
        ...invoice,
        status: 'PAID',
        preimage: body.preimage,
        paidAt: new Date()
      })
    })

    // Plugin lifecycle hook — fire-and-forget; a plugin failure never
    // affects the claim response (see plugins/_runtime/hooks.ts).
    dispatchHookAndForget('invoice:paid', {
      invoiceId: invoice.id,
      paymentHash: invoice.paymentHash,
      amountSats: invoice.amountSats,
      purpose: invoice.purpose,
      userId: user.id
    })

    if (createsAddress && typeof result.username === 'string') {
      logActivity.fireAndForget({
        category: 'ADDRESS',
        event: ActivityEvent.ADDRESS_CREATED,
        message: `Lightning address claimed: ${result.username}`,
        userId: user.id,
        metadata: {
          username: result.username,
          via: 'invoice_claim',
          invoiceId: invoice.id
        }
      })
    }

    return NextResponse.json(result)
  }
)
