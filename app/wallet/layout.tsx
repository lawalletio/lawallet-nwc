'use client'

import type React from 'react'

import { WalletProvider } from '@/providers/wallet'
import { APIProvider } from '@/providers/api'
import { Toaster } from '@/components/ui/toaster'
import { SettingsProvider } from '@/providers/settings'

export default function WalletLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <APIProvider>
      <SettingsProvider>
        <WalletProvider>
          <Toaster />
          {children}
        </WalletProvider>
      </SettingsProvider>
    </APIProvider>
  )
}
