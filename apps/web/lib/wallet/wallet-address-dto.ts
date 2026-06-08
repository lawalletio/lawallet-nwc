import type { LightningAddress, RemoteWallet } from '@/lib/generated/prisma'

export type WalletAddressMode = 'IDLE' | 'ALIAS' | 'CUSTOM_NWC' | 'DEFAULT_NWC'
export type EffectiveNwcMode = 'NONE' | 'RECEIVE' | 'SEND_RECEIVE'

export interface WalletAddressDto {
  username: string
  mode: WalletAddressMode
  redirect: string | null
  /** The RemoteWallet this address is bound to (CUSTOM_NWC), or null. */
  remoteWalletId: string | null
  isPrimary: boolean
  /** Server-derived effective capability for this address. */
  nwcMode: EffectiveNwcMode
  createdAt: string
  updatedAt: string
}

type AddressWithWallet = LightningAddress & {
  remoteWallet: RemoteWallet | null
}

/**
 * Pull the `mode` capability out of a RemoteWallet's `config`. Only ACTIVE
 * wallets contribute a capability — a disabled/revoked wallet reads as NONE
 * so the UI never implies a dead wallet can transact. NWC configs carry
 * `mode: 'RECEIVE' | 'SEND_RECEIVE'`; anything missing/odd falls back to
 * RECEIVE (the safer, more limited capability).
 */
function walletCapability(wallet: RemoteWallet | null): EffectiveNwcMode {
  if (!wallet || wallet.status !== 'ACTIVE') return 'NONE'
  const mode = (wallet.config as { mode?: unknown } | null)?.mode
  return mode === 'SEND_RECEIVE' ? 'SEND_RECEIVE' : 'RECEIVE'
}

/**
 * Derives the effective capability for a single address.
 *
 *   IDLE / ALIAS   → NONE  (the address never produces invoices via a wallet)
 *   CUSTOM_NWC     → the bound RemoteWallet's capability, or NONE if absent
 *   DEFAULT_NWC    → the user's default RemoteWallet's capability, or NONE
 *
 * Centralised here so list, detail and create routes stay consistent and the
 * client never has to guess.
 */
export function deriveEffectiveNwcMode(
  address: AddressWithWallet,
  defaultWallet: RemoteWallet | null,
): EffectiveNwcMode {
  switch (address.mode) {
    case 'IDLE':
    case 'ALIAS':
      return 'NONE'
    case 'CUSTOM_NWC':
      return walletCapability(address.remoteWallet)
    case 'DEFAULT_NWC':
      return walletCapability(defaultWallet)
  }
}

export function toWalletAddressDto(
  address: AddressWithWallet,
  defaultWallet: RemoteWallet | null,
): WalletAddressDto {
  return {
    username: address.username,
    mode: address.mode,
    redirect: address.redirect ?? null,
    remoteWalletId: address.remoteWalletId ?? null,
    isPrimary: address.isPrimary,
    nwcMode: deriveEffectiveNwcMode(address, defaultWallet),
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  }
}
