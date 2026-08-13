import { after, NextResponse } from 'next/server'
import { requireUserId } from '@/lib/auth/account'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { sweepMissedPayments } from '@/lib/remote-wallet-forwarding/capture-sweep'
import { reconcileRemoteWalletForwarding } from '@/lib/remote-wallet-forwarding/reconcile'
import { emitForwardingUpdated } from '@/lib/remote-wallet-forwarding/service'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { loadOwnedRemoteWallet } from '@/lib/remote-wallets/owned'
import { validateParams } from '@/lib/validation/middleware'
import { idParam } from '@/lib/validation/schemas'
import { ConflictError, NotFoundError } from '@/types/server/errors'
import { withErrorHandling } from '@/types/server/error-handler'

const OPEN_RECEIPT_STATUSES = [
  'RECEIVED',
  'FORWARDING',
  'PARTIAL',
  'BLOCKED'
] as const

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await rateLimit(request, RateLimitPresets.sensitive)
    const userId = await requireUserId(request)
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

    // Recover anything the listener never delivered first, so this button can
    // un-stick a payment that has no receipt at all rather than answering
    // "nothing to forward" while the funds sit there. Best-effort: a wallet
    // that won't answer must not turn Force Forward into a 500.
    try {
      await sweepMissedPayments({ walletIds: [id], force: true })
    } catch (error) {
      logger.warn(
        { err: error, remoteWalletId: id },
        'remote_wallet_forwarding.capture_sweep_failed'
      )
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
      throw new ConflictError('There are no pending funds to forward')
    }

    emitForwardingUpdated()
    after(() => reconcileRemoteWalletForwarding({ walletIds: [id] }))
    return NextResponse.json(
      { accepted: true, forwardingReceipts: result.count },
      { status: 202 }
    )
  }
)
