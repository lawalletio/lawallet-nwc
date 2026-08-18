import type React from 'react'
import { WalletShell } from '@/components/wallet/wallet-shell'
import { PwaManager } from '@/components/pwa/pwa-manager'
import { FirstLoadProgressProvider } from '@/components/pwa/first-load-progress'
import { RoutePrefetcher } from '@/components/wallet/route-prefetcher'
import { WalletNwcProvider } from '@/components/wallet/nwc-provider'

export default function WalletAppLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <FirstLoadProgressProvider>
      <RoutePrefetcher />
      <WalletNwcProvider>
        <WalletShell>
          {children}
          <PwaManager />
        </WalletShell>
      </WalletNwcProvider>
    </FirstLoadProgressProvider>
  )
}
