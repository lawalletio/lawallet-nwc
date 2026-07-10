import type { CardDesign } from './card-design'
import type { Ntag424Public } from './ntag424'

export type Card = {
  id: string
  design: CardDesign
  ntag424?: Ntag424Public
  createdAt: Date
  title?: string
  lastUsedAt?: Date
  pubkey?: string
  username?: string
  otc?: string
  /** RemoteWallet this card spends from, or null if unbound. */
  remoteWalletId?: string | null
  /** Authenticated owner's default spend wallet, only present on wallet-scoped reads. */
  defaultRemoteWalletId?: string | null
  /** Card kind. SIMPLE supports ownership-transfer; MASTER reserved for sharing. */
  kind?: 'SIMPLE' | 'MASTER'
  /**
   * True once the card's reset (wipe) keys have been exported — it's
   * decommissioned and can only be re-wiped or deleted, never re-used.
   */
  blocked?: boolean
  /** True when the card owner has temporarily paused tap-to-pay. */
  disabled?: boolean
}
