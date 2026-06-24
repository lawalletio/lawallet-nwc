'use client'

import React, { Suspense, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Spinner } from '@/components/ui/spinner'
import { BrandingTab } from '@/components/admin/settings/branding-tab'
import { WalletTab } from '@/components/admin/settings/wallet-tab'
import { InfrastructureTab } from '@/components/admin/settings/infrastructure-tab'
import { DeviceTokensTab } from '@/components/admin/settings/device-tokens-tab'
import { useAuth } from '@/components/admin/auth-context'
import { Role } from '@/lib/auth/permissions'

function SettingsContent() {
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') || 'infrastructure'
  const router = useRouter()
  const { status, role } = useAuth()

  // Settings is ADMIN-only. The parent `AdminLayoutShell` already blocks
  // unauthenticated users with the login page, so here we only need to catch
  // authenticated non-admins (VIEWER / OPERATOR / USER) and bounce them.
  // Running the redirect in an effect ensures we don't call router.replace
  // during render, and the guard below short-circuits the render so the
  // Settings UI never flashes for unauthorized users.
  const isAdmin = status === 'authenticated' && role === Role.ADMIN
  useEffect(() => {
    if (status === 'authenticated' && role !== Role.ADMIN) {
      // Fixed id so StrictMode's double-mount in dev (and any re-render
      // before the redirect finishes) doesn't stack duplicate toasts.
      toast.error('Only administrators can access settings.', { id: 'settings-admin-only' })
      router.replace('/admin')
    }
  }, [status, role, router])

  // While the auth state is loading, or while we're redirecting a non-admin
  // away, render a lightweight placeholder instead of the full settings UI.
  // This prevents any of the tabs (Branding/Wallet/Infrastructure) from ever
  // mounting for a user without the ADMIN role.
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={24} />
      </div>
    )
  }

  function navigate(url: string) {
    router.push(url)
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Settings"
        subtitle="Manage your community configuration."
        tabs={[
          { label: 'Infrastructure', active: activeTab === 'infrastructure', onClick: () => navigate('/admin/settings?tab=infrastructure') },
          { label: 'Branding', active: activeTab === 'branding', onClick: () => navigate('/admin/settings?tab=branding') },
          { label: 'Wallet', active: activeTab === 'wallet', onClick: () => navigate('/admin/settings?tab=wallet') },
          { label: 'Device Tokens', active: activeTab === 'device-tokens', onClick: () => navigate('/admin/settings?tab=device-tokens') },
        ]}
      />

      {activeTab === 'infrastructure' && <InfrastructureTab />}
      {activeTab === 'branding' && <BrandingTab />}
      {activeTab === 'wallet' && <WalletTab />}
      {activeTab === 'device-tokens' && <DeviceTokensTab />}
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
