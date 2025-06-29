import type { CardDesign } from "./card-design"
import type { Ntag424 } from "./ntag424"

export type Card = {
  id: string
  design: CardDesign
  ntag424: Ntag424
  createdAt: Date
  title?: string
  lastUsedAt?: Date
  pubkey?: string
  otc?: string
}
