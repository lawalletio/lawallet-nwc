import { Card } from './card'

export interface WalletState {
  privateKey: string | null
  publicKey: string | null
  lightningAddress: string | null
  nwcUri: string | null
  balance: number
  isInitialized: boolean
  userId: string | null
}

export interface WalletContextType extends WalletState {
  setPrivateKey: (key: string) => void
  setLightningAddress: (address: string) => void
  setNwcUri: (uri: string) => void
  setUserId: (userId: string) => void
  logout: () => void
  npub: string | null
  isHydrated: boolean
}
