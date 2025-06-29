export interface WalletState {
  privateKey: string | null
  publicKey: string | null
  lightningAddress: string | null
  nwcUri: string | null
  balance: number
}

export interface WalletContextType extends WalletState {
  setPrivateKey: (key: string) => void
  setLightningAddress: (address: string) => void
  setNwcUri: (uri: string) => void
  logout: () => void
}
