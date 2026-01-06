import { Card } from './card'

export interface WalletState {
  lightningAddress: string | null
  nwcUri: string | null
  balance: number
}

export interface WalletContextType extends WalletState {
  getWalletData: () => Promise<void>
  setLightningAddress: (username: string) => Promise<void>
  setNwcUri: (uri: string) => Promise<void>
  logout: () => void
  isConnected: boolean
  isHydrated: boolean
  sendPayment: (amount: number, to: string, card?: Card) => Promise<{ success: boolean; error?: string }>
}
