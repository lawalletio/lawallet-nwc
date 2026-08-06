import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'

export function getPrimaryAddress(
  addresses: WalletAddress[] | null | undefined
) {
  return addresses?.find(address => address.isPrimary) ?? null
}

export function getPrimaryWalletId(
  addresses: WalletAddress[] | null | undefined
): string | null {
  const primaryAddress = getPrimaryAddress(addresses)
  return primaryAddress?.mode === 'CUSTOM_NWC'
    ? (primaryAddress.remoteWalletId ?? null)
    : null
}

export function getPrimaryWallet(
  wallets: RemoteWalletData[] | null | undefined,
  addresses: WalletAddress[] | null | undefined
): RemoteWalletData | null {
  const primaryWalletId = getPrimaryWalletId(addresses)
  return primaryWalletId
    ? (wallets?.find(wallet => wallet.id === primaryWalletId) ?? null)
    : null
}

export function withDerivedPrimaryWalletFlags(
  wallets: RemoteWalletData[] | null | undefined,
  addresses: WalletAddress[] | null | undefined
): RemoteWalletData[] {
  const primaryWalletId = getPrimaryWalletId(addresses)
  return (wallets ?? []).map(wallet => {
    const isDefault = wallet.id === primaryWalletId
    return wallet.isDefault === isDefault ? wallet : { ...wallet, isDefault }
  })
}

export function routesThroughPrimaryWallet(
  address: WalletAddress,
  walletId: string,
  addresses: WalletAddress[] | null | undefined
): boolean {
  return (
    address.mode === 'CUSTOM_NWC' && address.remoteWalletId === walletId
  )
}
