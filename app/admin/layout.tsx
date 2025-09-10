import type React from 'react'
import type { Metadata } from 'next'
import { AdminWrapper } from '@/components/admin/admin-wrapper'
import { CardsProvider } from '@/providers/card'
import { CardDesignsProvider } from '@/providers/card-designs'
import { LightningAddressesProvider } from '@/providers/lightning-addresses'
import { APIProvider } from '@/providers/api'
import { SettingsProvider } from '@/providers/settings'

export const metadata: Metadata = {
  title: 'Admin Dashboard - LaWallet',
  description: 'Manage your BoltCard + NWC system'
}

export default function AdminLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="admin-root light min-h-screen bg-background">
      <APIProvider>
        <SettingsProvider>
          <CardsProvider>
            <CardDesignsProvider>
              <LightningAddressesProvider>
                <AdminWrapper>{children}</AdminWrapper>
              </LightningAddressesProvider>
            </CardDesignsProvider>
          </CardsProvider>
        </SettingsProvider>
      </APIProvider>
    </div>
  )
}
