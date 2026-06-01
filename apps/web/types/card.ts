import type { CardDesign } from './card-design'
import type { Ntag424 } from './ntag424'

export type Card = {
  id: string
  design: CardDesign
  ntag424?: Ntag424
  createdAt: Date
  title?: string
  lastUsedAt?: Date
  pubkey?: string
  username?: string
  otc?: string
  /** RemoteWallet this card spends from, or null if unbound. */
  remoteWalletId?: string | null
  /** Card kind. SIMPLE supports ownership-transfer; MASTER reserved for sharing. */
  kind?: 'SIMPLE' | 'MASTER'
}
