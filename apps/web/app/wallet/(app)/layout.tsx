import type React from 'react'
import { WalletShell } from '@/components/wallet/wallet-shell'

export default function WalletAppLayout({ children }: { children: React.ReactNode }) {
  return <WalletShell>{children}</WalletShell>
}
