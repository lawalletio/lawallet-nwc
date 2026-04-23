import type React from 'react'
import type { Metadata } from 'next'
import { WalletShell } from '@/components/wallet/wallet-shell'

export const metadata: Metadata = {
  title: 'Wallet - LaWallet',
}

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <WalletShell>{children}</WalletShell>
}
