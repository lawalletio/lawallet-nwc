'use client'

import type React from 'react'

import { WalletProvider } from '@/providers/wallet'
import { APIProvider } from '@/providers/api'
import { Toaster } from '@/components/ui/toaster'

export default function WalletLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <APIProvider>
      <WalletProvider>
        <Toaster />
        {children}
      </WalletProvider>
    </APIProvider>
  )
}
