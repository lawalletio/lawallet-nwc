'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { WalletContextType, WalletState } from '@/types/wallet'
import { getPublicKeyFromPrivate } from '@/lib/nostr'
import { nip19 } from 'nostr-tools'
import { LN, nwc } from '@getalby/sdk'
import { toast } from '@/hooks/use-toast'

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [walletState, setWalletState] = useState<WalletState>({
    privateKey: null,
    publicKey: null,
    lightningAddress: null,
    nwcUri: null,
    balance: 0,
    isInitialized: false // Added initialization state
  })

  const [nwcObject, setNwcObject] = useState<nwc.NWCClient | null>(null)
  const [isHydrated, setIsHydrated] = useState(false) // Track hydration

  const refreshBalance = async (notification?: any) => {
    console.log(notification)

    if (notification) {
      const verb =
        notification.notification.type === 'incoming' ? 'Received' : 'Sent'
      const message = `${verb} ${notification.notification.amount / 1000} sats`
      console.info(message)
      toast({ title: message })
    }

    const balance = await nwcObject?.getBalance()
    console.info('balance:', balance)
    setWalletState(prev => ({ ...prev, balance: balance?.balance ?? 0 }))
  }

  useEffect(() => {
    if (!walletState.nwcUri) {
      setNwcObject(null)
      nwcObject?.close()
      return
    }

    console.log('New nwc object')
    const nwcClient = new nwc.NWCClient({
      nostrWalletConnectUrl: walletState.nwcUri
    })
    setNwcObject(nwcClient)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletState.nwcUri])

  useEffect(() => {
    if (nwcObject) {
      nwcObject.subscribeNotifications(refreshBalance)
      refreshBalance()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nwcObject])

  const npub = useMemo(() => {
    if (!walletState.publicKey) return ''
    try {
      return nip19.npubEncode(walletState.publicKey)
    } catch (e) {
      return null
    }
  }, [walletState.publicKey])

  // Load wallet data from localStorage on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem('wallet')
    if (savedWallet) {
      try {
        const parsed = JSON.parse(savedWallet)
        let publicKey = parsed.publicKey
        if (parsed.privateKey) {
          try {
            publicKey = getPublicKeyFromPrivate(parsed.privateKey)
          } catch (e) {
            publicKey = null
          }
        }
        setWalletState(prev => ({
          ...prev,
          ...parsed,
          publicKey,
          isInitialized: !!parsed.privateKey
        }))
      } catch (error) {
        console.error('Failed to parse saved wallet data:', error)
      }
    }
    setIsHydrated(true) // Mark as hydrated after attempting to load
  }, [])

  // Save wallet data to localStorage whenever it changes
  useEffect(() => {
    if (walletState.privateKey) {
      localStorage.setItem('wallet', JSON.stringify(walletState))
    }
  }, [walletState])

  const setPrivateKey = (privateKeyHex: string) => {
    try {
      const publicKey = getPublicKeyFromPrivate(privateKeyHex)
      setWalletState(prev => ({
        ...prev,
        privateKey: privateKeyHex,
        publicKey,
        isInitialized: true // Set initialized when private key is set
      }))
    } catch (error) {
      console.error('Failed to set private key:', error)
      throw new Error('Invalid private key')
    }
  }

  const setLightningAddress = (address: string) => {
    setWalletState(prev => ({ ...prev, lightningAddress: address }))
  }

  const setNwcUri = (uri: string) => {
    setWalletState(prev => ({ ...prev, nwcUri: uri }))
  }

  const logout = () => {
    setWalletState({
      privateKey: null,
      publicKey: null,
      lightningAddress: null,
      nwcUri: null,
      balance: 0,
      isInitialized: false // Reset initialization on logout
    })
    localStorage.removeItem('wallet')
  }

  const contextValue: WalletContextType = {
    ...walletState,
    setPrivateKey,
    setLightningAddress,
    setNwcUri,
    logout,
    npub,
    isHydrated // Expose hydration state
  }

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}
