"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState } from "react"
import type { WalletContextType, WalletState } from "@/types/wallet"
import { getPublicKeyFromPrivate } from "@/lib/nostr"

const WalletContext = createContext<WalletContextType | undefined>(undefined)

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [walletState, setWalletState] = useState<WalletState>({
    privateKey: null,
    publicKey: null,
    lightningAddress: null,
    nwcUri: null,
    balance: 125000, // Mock balance in sats
  })

  // Load wallet data from localStorage on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem("wallet")
    if (savedWallet) {
      try {
        const parsed = JSON.parse(savedWallet)
        setWalletState((prev) => ({ ...prev, ...parsed }))
      } catch (error) {
        console.error("Failed to parse saved wallet data:", error)
      }
    }
  }, [])

  // Save wallet data to localStorage whenever it changes
  useEffect(() => {
    if (walletState.privateKey) {
      localStorage.setItem("wallet", JSON.stringify(walletState))
    }
  }, [walletState])

  const setPrivateKey = (privateKeyHex: string) => {
    try {
      const publicKey = getPublicKeyFromPrivate(privateKeyHex)
      setWalletState((prev) => ({
        ...prev,
        privateKey: privateKeyHex,
        publicKey,
      }))
    } catch (error) {
      console.error("Failed to set private key:", error)
      throw new Error("Invalid private key")
    }
  }

  const setLightningAddress = (address: string) => {
    setWalletState((prev) => ({ ...prev, lightningAddress: address }))
  }

  const setNwcUri = (uri: string) => {
    setWalletState((prev) => ({ ...prev, nwcUri: uri }))
  }

  const logout = () => {
    setWalletState({
      privateKey: null,
      publicKey: null,
      lightningAddress: null,
      nwcUri: null,
      balance: 125000,
    })
    localStorage.removeItem("wallet")
  }

  const contextValue: WalletContextType = {
    ...walletState,
    setPrivateKey,
    setLightningAddress,
    setNwcUri,
    logout,
  }

  return <WalletContext.Provider value={contextValue}>{children}</WalletContext.Provider>
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider")
  }
  return context
}
