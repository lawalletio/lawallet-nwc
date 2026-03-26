'use client'

import React, { Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Button } from '@/components/ui/button'
import { BrandingTab } from '@/components/admin/settings/branding-tab'
import { WalletTab } from '@/components/admin/settings/wallet-tab'
import { InfrastructureTab } from '@/components/admin/settings/infrastructure-tab'

function SettingsContent() {
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') || 'wallet'
  const router = useRouter()

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Settings"
        subtitle="Lorem ipsum dolor sit amet."
        actions={
          <>
            <Button variant="secondary">Cancel</Button>
            <Button variant="theme">Save Changes</Button>
          </>
        }
        tabs={[
          { label: 'Wallet', active: activeTab === 'wallet', onClick: () => router.push('/admin/settings?tab=wallet') },
          { label: 'Branding', active: activeTab === 'branding', onClick: () => router.push('/admin/settings?tab=branding') },
          { label: 'Infrastructure', active: activeTab === 'infrastructure', onClick: () => router.push('/admin/settings?tab=infrastructure') },
        ]}
      />

      {activeTab === 'branding' && <BrandingTab />}
      {activeTab === 'wallet' && <WalletTab />}
      {activeTab === 'infrastructure' && <InfrastructureTab />}
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  )
}
