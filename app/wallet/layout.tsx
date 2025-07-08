'use client'

import type React from 'react'

import { WalletProvider } from '@/providers/wallet'
import { Toaster } from '@/components/ui/toaster'

export default function WalletLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <WalletProvider>
      <Toaster />
      {children}
    </WalletProvider>
  )
}
