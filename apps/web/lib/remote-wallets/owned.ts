import type { RemoteWallet } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/types/server/errors'

/**
 * Load a RemoteWallet the caller owns. A wallet owned by somebody else is
 * reported as missing so the response cannot be used to probe for wallet ids.
 */
export async function loadOwnedRemoteWallet(
  walletId: string,
  userId: string
): Promise<RemoteWallet> {
  const wallet = await prisma.remoteWallet.findUnique({
    where: { id: walletId }
  })
  if (!wallet || wallet.userId !== userId) {
    throw new NotFoundError('Wallet not found')
  }
  return wallet
}
