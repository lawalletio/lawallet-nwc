import type { RemoteWallet } from '@/lib/generated/prisma'
import { resolveAccountId } from '@/lib/auth/account'
import { Permission } from '@/lib/auth/permissions'
import { authenticate, authHasPermission } from '@/lib/auth/unified-auth'
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

/**
 * Load a RemoteWallet the caller is allowed to *look at*: their own, or
 * anybody's when the caller holds {@link Permission.REMOTE_WALLETS_READ}
 * (ADMIN). Read handlers only — {@link loadOwnedRemoteWallet} still guards
 * every mutation, so an admin can inspect a wallet but can never spend from
 * it, retry a forward, or rewrite its forwarding plan.
 *
 * A caller without the permission gets the same 404 as a genuine miss rather
 * than a 403, so wallet ids can't be probed.
 *
 * `isOwner` travels back to the UI so it can render view-only.
 */
export async function loadViewableRemoteWallet(
  walletId: string,
  request: Request
): Promise<{ wallet: RemoteWallet; isOwner: boolean; userId: string | null }> {
  const auth = await authenticate(request)
  const userId = await resolveAccountId(auth.pubkey)
  const wallet = await prisma.remoteWallet.findUnique({
    where: { id: walletId }
  })
  if (!wallet) throw new NotFoundError('Wallet not found')
  if (userId && wallet.userId === userId) {
    return { wallet, isOwner: true, userId }
  }
  if (!authHasPermission(auth, Permission.REMOTE_WALLETS_READ)) {
    throw new NotFoundError('Wallet not found')
  }
  return { wallet, isOwner: false, userId }
}
