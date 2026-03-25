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
  const activeTab = searchParams.get('tab') || 'branding'
  const router = useRouter()

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Settings"
        actions={
          <>
            <Button variant="secondary">Cancel</Button>
            <Button>Save Changes</Button>
          </>
        }
        tabs={[
          { label: 'Branding', active: activeTab === 'branding', onClick: () => router.push('/admin/settings?tab=branding') },
          { label: 'Wallet', active: activeTab === 'wallet', onClick: () => router.push('/admin/settings?tab=wallet') },
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
