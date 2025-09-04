'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'
import type { WalletContextType, WalletState } from '@/types/wallet'
import { nwc } from '@getalby/sdk'
import { toast } from '@/hooks/use-toast'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { useAPI } from '@/providers/api'

export const WalletContext = createContext<WalletContextType | undefined>(
  undefined
)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [walletState, setWalletState] = useState<WalletState>({
    lightningAddress: null,
    nwcUri: null,
    balance: 0
  })

  const [nwcObject, setNwcObject] = useState<nwc.NWCClient | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const { userId, get, put, logout: logoutApi } = useAPI()

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

    try {
      const balance = await nwcObject?.getBalance()
      console.info('balance:', balance)
      setWalletState(prev => ({ ...prev, balance: balance?.balance ?? 0 }))
      setIsConnected(true)
    } catch {
      setIsConnected(false)
    }
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

  // Load wallet data from localStorage on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem('wallet')
    if (savedWallet) {
      try {
        const parsed = JSON.parse(savedWallet)
        setWalletState(prev => ({
          ...prev,
          lightningAddress: parsed.lightningAddress || null,
          nwcUri: parsed.nwcUri || null,
          balance: parsed.balance || 0
        }))
      } catch (error) {
        console.error('Failed to parse saved wallet data:', error)
      }
    }
    setIsHydrated(true)
  }, [])

  // Save wallet data to localStorage whenever it changes
  useEffect(() => {
    // Only save to localStorage after hydration is complete to avoid overwriting during initial load
    if (isHydrated) {
      const existingData = localStorage.getItem('wallet')
      let walletData = {}
      if (existingData) {
        try {
          walletData = JSON.parse(existingData)
        } catch (e) {
          console.error('Failed to parse existing wallet data:', e)
        }
      }
      localStorage.setItem(
        'wallet',
        JSON.stringify({
          ...walletData,
          lightningAddress: walletState.lightningAddress,
          nwcUri: walletState.nwcUri,
          balance: walletState.balance
        })
      )
    }
  }, [walletState, isHydrated])

  const setLightningAddress = async (username: string) => {
    if (!userId) {
      setWalletState(prev => ({
        ...prev,
        lightningAddress: username
      }))
      return
    }

    try {
      const { data, error } = await put(
        `/api/users/${userId}/lightning-address`,
        {
          username
        }
      )

      if (error) {
        throw new Error(error)
      }

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
    if (!userId) {
      setWalletState(prev => ({ ...prev, nwcUri }))
      return
    }

    try {
      const { data, error } = await put(`/api/users/${userId}/nwc`, {
        nwcUri
      })

      if (error) {
        throw new Error(error)
      }

      setWalletState(prev => ({ ...prev, nwcUri: data.nwcUri }))

      return data
    } catch (error) {
      console.error('Error setting NWC URI:', error)
      throw error
    }
  }

  const getWalletData = async () => {
    const { data, error } = await get(`/api/users/wallet`)
    if (error) {
      throw new Error(error)
    }
    return data
  }

  const logout = () => {
    setWalletState({
      lightningAddress: null,
      nwcUri: null,
      balance: 0
    })
    localStorage.removeItem('wallet')
    logoutApi()
  }

  const contextValue: WalletContextType = {
    ...walletState,
    getWalletData,
    setLightningAddress,
    setNwcUri,
    logout,
    isConnected,
    isHydrated
  }

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  )
}
