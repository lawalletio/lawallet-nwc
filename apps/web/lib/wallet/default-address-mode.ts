import { prisma } from '@/lib/prisma'

/**
 * The mode a newly created lightning address should default to when the caller
 * doesn't choose one explicitly.
 *
 * Routes through the user's default wallet (`DEFAULT_NWC`) only when they
 * actually have an ACTIVE one; otherwise the address stays `IDLE`
 * (intentionally disabled) until a wallet is connected or a redirect is set.
 * This stops a freshly registered address from silently advertising a wallet
 * that isn't there.
 */
export async function resolveDefaultAddressMode(
  userId: string,
): Promise<'DEFAULT_NWC' | 'IDLE'> {
  const activeDefaultWallet = await prisma.remoteWallet.findFirst({
    where: { userId, isDefault: true, status: 'ACTIVE' },
    select: { id: true },
  })
  return activeDefaultWallet ? 'DEFAULT_NWC' : 'IDLE'
}
