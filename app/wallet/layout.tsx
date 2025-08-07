'use client'

import type React from 'react'

import { WalletProvider } from '@/providers/wallet'
import { APIProvider } from '@/providers/api'
import { useWallet } from '@/hooks/use-wallet'
import { Toaster } from '@/components/ui/toaster'

export default function WalletLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <WalletProvider>
      <APIProviderWrapper>
        <Toaster />
        {children}
      </APIProviderWrapper>
    </WalletProvider>
  )
}

function APIProviderWrapper({ children }: { children: React.ReactNode }) {
  const { privateKey, publicKey } = useWallet()
  
  return (
    <APIProvider privateKey={privateKey} publicKey={publicKey}>
      {children}
    </APIProvider>
  )
}
