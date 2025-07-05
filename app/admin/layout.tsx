import type React from 'react'
import type { Metadata } from 'next'
import { AdminProvider } from '@/providers/admin-provider'
import { AdminWrapper } from '@/components/admin/admin-wrapper'
import { CardsProvider } from '@/providers/card'
import { CardDesignsProvider } from '@/providers/card-designs'
import { LightningAddressesProvider } from '@/providers/lightning-addresses'

export const metadata: Metadata = {
  title: 'Admin Dashboard - BoltCard + NWC',
  description: 'Manage your BoltCard + NWC system'
}

export default function AdminLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="admin-root light min-h-screen bg-background">
      <AdminProvider>
        <CardsProvider>
          <CardDesignsProvider>
            <LightningAddressesProvider>
              <AdminWrapper>{children}</AdminWrapper>
            </LightningAddressesProvider>
          </CardDesignsProvider>
        </CardsProvider>
      </AdminProvider>
    </div>
  )
}
