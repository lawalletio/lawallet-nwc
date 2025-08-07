'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { WalletContextType, WalletState } from '@/types/wallet'
import { getPublicKeyFromPrivate } from '@/lib/nostr'
import { nip19 } from 'nostr-tools'
import { nwc } from '@getalby/sdk'
import { toast } from '@/hooks/use-toast'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [walletState, setWalletState] = useState<WalletState>({
    privateKey: null,
    publicKey: null,
    lightningAddress: null,
    nwcUri: null,
    balance: 0,
    isInitialized: false, // Added initialization state
    userId: null
  })

  const [nwcObject, setNwcObject] = useState<nwc.NWCClient | null>(null)
  const [isHydrated, setIsHydrated] = useState(false) // Track hydration

  const refreshBalance = async (notification?: any) => {
    console.log(notification)

    if (notification) {
      const { type, amount } = notification.notification
      toast({
        title: type === 'incoming' ? 'Received' : 'Paid',
        variant: type === 'incoming' ? 'default' : 'destructive',
        description: (
          <span className="flex items-center gap-2">
            {type === 'incoming' ? (
              <ArrowDownLeft className="w-4 h-4 text-green-600" />
            ) : (
              <ArrowUpRight className="w-4 h-4 text-red-600" />
            )}
            {type === 'incoming' ? '+' : '-'}
            {amount / 1000} sats
          </span>
        )
      })
    }

    const balance = await nwcObject?.getBalance()
    console.info('balance:', balance)
    setWalletState(prev => ({ ...prev, balance: balance?.balance ?? 0 }))
  }

  const enabled = false

  useEffect(() => {
    if (!enabled) return
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
  }, [walletState.nwcUri, enabled])

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

  const setLightningAddress = async (username: string) => {
    if (!walletState.userId) {
      throw new Error('User ID is required to set lightning address')
    }

    try {
      const response = await fetch(
        `/api/user/${walletState.userId}/lightning-address`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ username })
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to set lightning address')
      }

      const data = await response.json()
      setWalletState(prev => ({
        ...prev,
        lightningAddress: data.lightningAddress
      }))

      return data
    } catch (error) {
      console.error('Error setting lightning address:', error)
      throw error
    }
  }

  const setNwcUri = async (nwcUri: string) => {
    if (!walletState.userId) {
      throw new Error('User ID is required to set NWC URI')
    }

    try {
      const response = await fetch(`/api/user/${walletState.userId}/nwc`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ nwcUri })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to set NWC URI')
      }

      const data = await response.json()
      setWalletState(prev => ({ ...prev, nwcUri: data.nwcUri }))

      return data
    } catch (error) {
      console.error('Error setting NWC URI:', error)
      throw error
    }
  }

  const setUserId = (userId: string) => {
    setWalletState(prev => ({ ...prev, userId }))
  }

  const logout = () => {
    setWalletState({
      privateKey: null,
      publicKey: null,
      lightningAddress: null,
      nwcUri: null,
      balance: 0,
      isInitialized: false, // Reset initialization on logout
      userId: null
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
    setUserId,
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
