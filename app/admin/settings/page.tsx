'use client'

import React, { Suspense, useState } from 'react'
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
  const [hasChanges, setHasChanges] = useState(false)

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Settings"
        subtitle="Lorem ipsum dolor sit amet."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!hasChanges}
              onClick={() => setHasChanges(false)}
            >
              Cancel
            </Button>
            <Button variant="theme" disabled={!hasChanges}>
              Save Changes
            </Button>
          </>
        }
        tabs={[
          { label: 'Branding', active: activeTab === 'branding', onClick: () => router.push('/admin/settings?tab=branding') },
          { label: 'Wallet', active: activeTab === 'wallet', onClick: () => router.push('/admin/settings?tab=wallet') },
          { label: 'Infrastructure', active: activeTab === 'infrastructure', onClick: () => router.push('/admin/settings?tab=infrastructure') },
        ]}
      />

      <div
        onChange={() => setHasChanges(true)}
        onClick={(e) => {
          // Detect switch/toggle clicks and theme picker changes
          const target = e.target as HTMLElement
          if (
            target.closest('[role="switch"]') ||
            target.closest('[data-track-change]')
          ) {
            setHasChanges(true)
          }
        }}
      >
        {activeTab === 'branding' && <BrandingTab />}
        {activeTab === 'wallet' && <WalletTab />}
        {activeTab === 'infrastructure' && <InfrastructureTab />}
      </div>
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
