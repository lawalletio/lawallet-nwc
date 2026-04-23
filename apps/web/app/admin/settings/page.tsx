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
import { SettingsFormProvider } from '@/components/admin/settings/settings-form-context'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useNavGuard } from '@/lib/client/hooks/use-nav-guard'
import { useTheme, type ThemePreset, type RoundingOption } from '@/lib/client/theme-context'
import { useAuth } from '@/components/admin/auth-context'
import { Role } from '@/lib/auth/permissions'

function SettingsContent() {
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') || 'branding'
  const router = useRouter()
  const { activePreset, setTheme, rounding, setRounding } = useTheme()
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

  const [hasChanges, setHasChanges] = useState(false)
  const [hasInvalid, setHasInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  // URL the user is attempting to navigate to while there are unsaved changes.
  // When non-null, the discard-confirmation AlertDialog is open.
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)

  // Track the "saved" (committed) state of theme and rounding
  const savedThemeRef = useRef<ThemePreset>(activePreset)
  const savedRoundingRef = useRef<RoundingOption>(rounding)

  // Populated by SettingsFormProvider — calls all registered tab save handlers
  const saveAllRef = useRef<(() => Promise<void>) | null>(null)
  // Populated by SettingsFormProvider — calls all registered tab reset handlers
  const resetAllRef = useRef<(() => void) | null>(null)

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
    // Reset each registered tab's local form state to the currently stored settings
    resetAllRef.current?.()
    setHasChanges(false)
    toast.info('Changes reverted')
  }

  // Called by the navigation guard and the topbar tab clicks. If the form is
  // clean we navigate immediately; otherwise we open the discard-confirmation
  // dialog with the URL pinned so we can complete the navigation on confirm.
  // Same-URL clicks (e.g. the currently-active tab) are a no-op.
  const attemptLeave = useCallback(
    (url: string) => {
      if (typeof window !== 'undefined') {
        const current = window.location.pathname + window.location.search
        if (url === current) return
      }
      if (!hasChanges) {
        router.push(url)
        return
      }
      setPendingUrl(url)
    },
    [hasChanges, router]
  )

  useNavGuard(hasChanges, attemptLeave)

  function confirmDiscard() {
    // Revert everything (same as explicit Cancel) before navigating away.
    setTheme(savedThemeRef.current)
    setRounding(savedRoundingRef.current)
    resetAllRef.current?.()
    setHasChanges(false)
    const url = pendingUrl
    setPendingUrl(null)
    if (url) router.push(url)
  }

  async function handleSave() {
    setSaving(true)
    try {
      // Update saved references to current state
      savedThemeRef.current = activePreset
      savedRoundingRef.current = rounding

      // Invoke all registered tab save handlers
      if (saveAllRef.current) {
        await saveAllRef.current()
      }

      setHasChanges(false)
      toast.success('Settings saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

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
              disabled={!hasChanges || saving || hasInvalid}
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
          { label: 'Branding', active: activeTab === 'branding', onClick: () => attemptLeave('/admin/settings?tab=branding') },
          { label: 'Wallet', active: activeTab === 'wallet', onClick: () => attemptLeave('/admin/settings?tab=wallet') },
          { label: 'Infrastructure', active: activeTab === 'infrastructure', onClick: () => attemptLeave('/admin/settings?tab=infrastructure') },
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
        <SettingsFormProvider
          onChange={() => setHasChanges(true)}
          onInvalidChange={setHasInvalid}
          registerRef={saveAllRef}
          resetRef={resetAllRef}
        >
          {activeTab === 'branding' && <BrandingTab />}
          {activeTab === 'wallet' && <WalletTab />}
          {activeTab === 'infrastructure' && <InfrastructureTab />}
        </SettingsFormProvider>
      </div>

      <AlertDialog
        open={pendingUrl !== null}
        onOpenChange={open => {
          if (!open) setPendingUrl(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes on this page. Leaving now will discard them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
