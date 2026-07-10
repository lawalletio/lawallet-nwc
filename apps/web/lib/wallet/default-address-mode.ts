import { prisma } from '@/lib/prisma'
import { getPrimaryRemoteWalletForUser } from '@/lib/wallet/primary-wallet'

/**
 * The mode a newly created lightning address should default to when the caller
 * doesn't choose one explicitly.
 *
 * Routes through the user's primary wallet (`DEFAULT_NWC`) only when their
 * primary Lightning Address is linked to an ACTIVE RemoteWallet; otherwise
 * the address stays `IDLE`
 * (intentionally disabled) until a wallet is connected or a redirect is set.
 * This stops a freshly registered address from silently advertising a wallet
 * that isn't there.
 */
export async function resolveDefaultAddressMode(
  userId: string,
): Promise<'DEFAULT_NWC' | 'IDLE'> {
  const primaryWallet = await getPrimaryRemoteWalletForUser(userId)
  return primaryWallet?.status === 'ACTIVE' ? 'DEFAULT_NWC' : 'IDLE'
}
