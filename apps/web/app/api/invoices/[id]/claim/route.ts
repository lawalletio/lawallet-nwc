import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { claimInvoiceSchema } from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'
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
    const { pubkey } = await authenticate(request)
    const { id } = await params
    const body = await validateBody(request, claimInvoiceSchema)

    // Resolve the user
    const user = await prisma.user.findUnique({ where: { pubkey } })
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
      throw new ValidationError('Invoice has expired')
    }

    // Verify preimage. A valid preimage proves the bolt11 was paid; the
    // invoice itself was only minted while paid registration was enabled.
    // We intentionally do NOT re-check `registration_ln_enabled` here — if
    // an operator toggles paid mode off after the invoice was issued, the
    // user already paid and is entitled to their address.
    if (!verifyPreimage(body.preimage, invoice.paymentHash)) {
      throw new ValidationError('Invalid preimage — does not match payment hash')
    }

    // Mark invoice as paid
    await prisma.invoice.update({
      where: { id },
      data: {
        status: 'PAID',
        preimage: body.preimage,
        paidAt: new Date(),
      },
    })

    // Execute purpose-specific action
    let result: Record<string, unknown> = { success: true }

    const createsAddress =
      invoice.purpose === 'REGISTRATION' || invoice.purpose === 'WALLET_ADDRESS'

    if (createsAddress) {
      const metadata = invoice.metadata as InvoiceMetadata | null
      const username = metadata?.username
      if (!username) {
        throw new ValidationError('Invoice metadata missing username')
      }

      // Re-check availability — the username may have been taken
      // between invoice mint and claim.
      const existing = await prisma.lightningAddress.findUnique({
        where: { username },
      })
      if (existing) {
        throw new ConflictError('Username was taken while payment was pending')
      }

      if (invoice.purpose === 'REGISTRATION') {
        // Primary swap: delete the existing primary first so the
        // partial-unique index on (userId) WHERE isPrimary=true
        // doesn't conflict, then insert the new primary row.
        const existingPrimary = await prisma.lightningAddress.findFirst({
          where: { userId: user.id, isPrimary: true },
        })
        if (existingPrimary) {
          await prisma.lightningAddress.delete({
            where: { username: existingPrimary.username },
          })
        }
        await prisma.lightningAddress.create({
          data: { username, userId: user.id, isPrimary: true },
        })
      } else {
        // Secondary add: never touches the existing primary.
        await prisma.lightningAddress.create({
          data: { username, userId: user.id, isPrimary: false },
        })
      }

      const { domain } = await getSettings(['domain'])
      result = {
        success: true,
        lightningAddress: `${username}@${domain}`,
        username,
      }
    }

    eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })
    if (createsAddress) {
      eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
    }

    return NextResponse.json(result)
  }
)
