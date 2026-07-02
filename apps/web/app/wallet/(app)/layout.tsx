import type React from 'react'
import { WalletShell } from '@/components/wallet/wallet-shell'
import { PwaManager } from '@/components/pwa/pwa-manager'

export default function WalletAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletShell>
      {children}
      <PwaManager />
    </WalletShell>
  )
}
