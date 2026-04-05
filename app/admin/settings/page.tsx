'use client'

import React, { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { BrandingTab } from '@/components/admin/settings/branding-tab'
import { WalletTab } from '@/components/admin/settings/wallet-tab'
import { InfrastructureTab } from '@/components/admin/settings/infrastructure-tab'
import { useTheme, type ThemePreset, type RoundingOption } from '@/lib/client/theme-context'

function SettingsContent() {
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') || 'branding'
  const router = useRouter()
  const { activePreset, setTheme, rounding, setRounding } = useTheme()

  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)

  // Track the "saved" (committed) state of theme and rounding
  const savedThemeRef = useRef<ThemePreset>(activePreset)
  const savedRoundingRef = useRef<RoundingOption>(rounding)

  // Warn on browser navigation (close tab, back button, external link)
  useEffect(() => {
    if (!hasChanges) return

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasChanges])

  // Detect theme/rounding changes vs saved state
  const checkThemeChanges = useCallback(() => {
    const themeChanged = activePreset.hex !== savedThemeRef.current.hex
    const roundingChanged = rounding !== savedRoundingRef.current
    if (themeChanged || roundingChanged) {
      setHasChanges(true)
    }
  }, [activePreset, rounding])

  useEffect(() => {
    checkThemeChanges()
  }, [checkThemeChanges])

  function handleCancel() {
    // Revert theme and rounding to last saved state
    setTheme(savedThemeRef.current)
    setRounding(savedRoundingRef.current)
    setHasChanges(false)
    toast.info('Changes reverted')
  }

  async function handleSave() {
    setSaving(true)
    try {
      // Update saved references to current state
      savedThemeRef.current = activePreset
      savedRoundingRef.current = rounding

      // TODO: Persist settings to backend via POST /api/settings
      // await apiClient.post('/api/settings', { theme: activePreset.hex, rounding })

      setHasChanges(false)
      toast.success('Settings saved')
    } catch (error) {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Settings"
        subtitle="Manage your community configuration."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!hasChanges}
              onClick={handleCancel}
            >
              Cancel
            </Button>
            <Button
              variant="theme"
              disabled={!hasChanges || saving}
              onClick={handleSave}
            >
              {saving ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
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
