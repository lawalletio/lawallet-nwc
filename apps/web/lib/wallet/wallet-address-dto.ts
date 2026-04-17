import type { LightningAddress, NWCConnection } from '@/lib/generated/prisma'

export type WalletAddressMode = 'IDLE' | 'ALIAS' | 'CUSTOM_NWC' | 'DEFAULT_NWC'
export type EffectiveNwcMode = 'NONE' | 'RECEIVE' | 'SEND_RECEIVE'

export interface WalletAddressDto {
  username: string
  mode: WalletAddressMode
  redirect: string | null
  nwcConnectionId: string | null
  isPrimary: boolean
  /** Server-derived effective NWC capability for this address. */
  nwcMode: EffectiveNwcMode
  createdAt: string
  updatedAt: string
}

type AddressWithConnection = LightningAddress & {
  nwcConnection: NWCConnection | null
}

/**
 * Derives the effective NWC mode for a single address.
 *
 *   IDLE / ALIAS   → NONE  (the address never produces invoices via NWC)
 *   CUSTOM_NWC     → the linked connection's mode, or NONE if dangling
 *   DEFAULT_NWC    → the user's primary connection's mode, or NONE if absent
 *
 * Centralised here so list, detail and create routes stay consistent and the
 * client never has to guess.
 */
export function deriveEffectiveNwcMode(
  address: AddressWithConnection,
  primaryNwc: NWCConnection | null,
): EffectiveNwcMode {
  switch (address.mode) {
    case 'IDLE':
    case 'ALIAS':
      return 'NONE'
    case 'CUSTOM_NWC':
      return address.nwcConnection?.mode ?? 'NONE'
    case 'DEFAULT_NWC':
      return primaryNwc?.mode ?? 'NONE'
  }
}

export function toWalletAddressDto(
  address: AddressWithConnection,
  primaryNwc: NWCConnection | null,
): WalletAddressDto {
  return {
    username: address.username,
    mode: address.mode,
    redirect: address.redirect ?? null,
    nwcConnectionId: address.nwcConnectionId ?? null,
    isPrimary: address.isPrimary,
    nwcMode: deriveEffectiveNwcMode(address, primaryNwc),
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  }
}
