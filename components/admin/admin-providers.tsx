'use client'

import React from 'react'
import { useAuth } from '@/components/admin/auth-context'
import { LoginModal } from '@/components/admin/login-modal'
import { SetupWizard } from '@/components/admin/setup-wizard'
import { AdminLayoutShell } from '@/components/admin/admin-layout-shell'

/**
 * Admin-specific providers. AuthProvider and Toaster live at the root layout
 * level so they're shared with the landing page.
 */
export function AdminProviders({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()

  return (
    <>
      <LoginModal open={status === 'unauthenticated'} />
      <SetupWizard />
      <AdminLayoutShell>{children}</AdminLayoutShell>
    </>
  )
}
