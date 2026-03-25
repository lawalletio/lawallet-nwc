'use client'

import React from 'react'
import { SetupWizard } from '@/components/admin/setup-wizard'
import { AdminLayoutShell } from '@/components/admin/admin-layout-shell'

/**
 * Admin-specific providers. AuthProvider and Toaster live at the root layout
 * level so they're shared with the landing page.
 *
 * LoginPage is now rendered by AdminLayoutShell when unauthenticated
 * (full-page login instead of modal overlay).
 */
export function AdminProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SetupWizard />
      <AdminLayoutShell>{children}</AdminLayoutShell>
    </>
  )
}
