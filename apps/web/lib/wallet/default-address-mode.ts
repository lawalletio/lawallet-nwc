import { getPrimaryRemoteWalletForUser } from '@/lib/wallet/primary-wallet'

export interface DefaultAddressRouting {
  mode: 'CUSTOM_NWC' | 'IDLE'
  /** Set only for CUSTOM_NWC — an address always names its wallet explicitly. */
  remoteWalletId: string | null
}

/**
 * How a newly created Lightning Address should route when the caller doesn't
 * choose for itself.
 *
 * Binds the user's primary-address wallet directly when it is ACTIVE, so the
 * address works the moment it exists; otherwise the address stays `IDLE`
 * (intentionally disabled) until a wallet is connected or a redirect is set.
 * This stops a freshly registered address from silently advertising a wallet
 * that isn't there.
 *
 * The binding is explicit rather than implied: an address that routes "through
 * whatever the primary wallet happens to be" used to change destination behind
 * the owner's back whenever the primary moved.
 */
export async function resolveDefaultAddressRouting(
  userId: string
): Promise<DefaultAddressRouting> {
  const primaryWallet = await getPrimaryRemoteWalletForUser(userId)
  return primaryWallet?.status === 'ACTIVE' && primaryWallet.id
    ? { mode: 'CUSTOM_NWC', remoteWalletId: primaryWallet.id }
    : { mode: 'IDLE', remoteWalletId: null }
}
