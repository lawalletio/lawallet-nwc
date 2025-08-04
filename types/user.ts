import { Card } from './card'
import { CardDesign } from './card-design'
import { LightningAddress } from './lightning-address'

export interface User {
  id: string
  pubkey: string
  createdAt: Date
  nwc?: string
  cardDesigns?: CardDesign[]
  lightningAddresses?: LightningAddress[]
  cards?: Card[]
}
