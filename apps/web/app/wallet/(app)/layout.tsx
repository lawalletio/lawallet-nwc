import type React from 'react'
import { WalletShell } from '@/components/wallet/wallet-shell'
import { PwaManager } from '@/components/pwa/pwa-manager'
import { FirstLoadProgressProvider } from '@/components/pwa/first-load-progress'
import { RoutePrefetcher } from '@/components/wallet/route-prefetcher'

export default function WalletAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <FirstLoadProgressProvider>
      <RoutePrefetcher />
      <WalletShell>
        {children}
        <PwaManager />
      </WalletShell>
    </FirstLoadProgressProvider>
  )
}
