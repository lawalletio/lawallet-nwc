import { Card } from './card'

export interface WalletState {
  lightningAddress: string | null
  nwcUri: string | null
  balance: number
  isInitialized: boolean
  userId: string | null
}

export interface WalletContextType extends WalletState {
  setLightningAddress: (username: string) => Promise<void>
  setNwcUri: (uri: string) => Promise<void>
  setUserId: (userId: string) => void
  logout: () => void
  isHydrated: boolean
}
