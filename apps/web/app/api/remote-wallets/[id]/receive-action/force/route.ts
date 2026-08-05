import { after, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountId } from '@/lib/auth/account'
import { prisma } from '@/lib/prisma'
import { reconcileRemoteWalletForwarding } from '@/lib/remote-wallet-forwarding/reconcile'
import {
  emitForwardingUpdated,
  loadOwnedRemoteWallet
} from '@/lib/remote-wallet-forwarding/service'
import { validateParams } from '@/lib/validation/middleware'
import { idParam } from '@/lib/validation/schemas'
import {
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import { withErrorHandling } from '@/types/server/error-handler'

const OPEN_RECEIPT_STATUSES = [
  'RECEIVED',
  'FORWARDING',
  'PARTIAL',
  'BLOCKED'
] as const

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await authenticate(request)
    const userId = await resolveAccountId(auth.pubkey)
    if (!userId) throw new NotFoundError('User not found')
    const { id } = validateParams(await params, idParam)
    await loadOwnedRemoteWallet(id, userId)

    const action = await prisma.remoteWalletReceiveAction.findUnique({
      where: { remoteWalletId: id },
      select: { id: true, enabled: true, currentRevisionId: true }
    })
    if (!action?.currentRevisionId) {
      throw new NotFoundError('Forwarding action not configured')
    }
    if (!action.enabled) {
      throw new ConflictError('Resume forwarding before forcing a run')
    }

    // Only move the receipt-level schedule forward. Existing PENDING/UNKNOWN
    // attempts and their leg state stay untouched so the reconciler must first
    // prove their outcome and can never dispatch a replacement ambiguously.
    const result = await prisma.remoteWalletForwardReceipt.updateMany({
      where: {
        actionId: action.id,
        walletId: id,
        userId,
        status: { in: [...OPEN_RECEIPT_STATUSES] }
      },
      data: { nextRetryAt: new Date() }
    })
    if (result.count === 0) {
      throw new ValidationError('There are no pending funds to forward')
    }

    emitForwardingUpdated()
    after(() => reconcileRemoteWalletForwarding({ walletIds: [id] }))
    return NextResponse.json(
      { accepted: true, forwardingReceipts: result.count },
      { status: 202 }
    )
  }
)
