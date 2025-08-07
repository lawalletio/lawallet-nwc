import { Card } from './card'

export interface WalletState {
  lightningAddress: string | null
  nwcUri: string | null
  balance: number
}

export interface WalletContextType extends WalletState {
  setLightningAddress: (username: string) => Promise<void>
  setNwcUri: (uri: string) => Promise<void>
  logout: () => void
  isHydrated: boolean
}
