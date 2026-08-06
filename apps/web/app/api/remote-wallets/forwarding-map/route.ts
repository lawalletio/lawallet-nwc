import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth/account'
import { NotFoundError } from '@/types/server/errors'
import { withErrorHandling } from '@/types/server/error-handler'

/**
 * Minimal owner-scoped projection used by the Connection Map. The relation
 * path is backed by RemoteWallet.userId, receiveAction.remoteWalletId unique,
 * currentRevisionId unique, and destinations.revisionId.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId(request)

  const actions = await prisma.remoteWalletReceiveAction.findMany({
    where: {
      remoteWallet: { userId },
      currentRevisionId: { not: null }
    },
    select: {
      remoteWalletId: true,
      enabled: true,
      currentRevision: {
        select: {
          destinations: {
            orderBy: { position: 'asc' },
            select: { address: true, allocationBps: true }
          }
        }
      }
    },
    orderBy: { remoteWalletId: 'asc' }
  })

  return NextResponse.json({
    actions: actions.map(action => ({
      walletId: action.remoteWalletId,
      enabled: action.enabled,
      destinations: action.currentRevision?.destinations ?? []
    }))
  })
})
