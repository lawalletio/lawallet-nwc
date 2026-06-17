'use client'

import React from 'react'
import { SetupWizard } from '@/components/admin/setup-wizard'
import { AdminLayoutShell } from '@/components/admin/admin-layout-shell'

/**
 * Admin-specific providers. AuthProvider and Toaster live at the root layout
 * level so they're shared with the landing page.
 *
 * AdminLayoutShell opens the shared LoginModal when unauthenticated so
 * landing and admin entry points use the same sign-in surface.
 */
export function AdminProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SetupWizard />
      <AdminLayoutShell>{children}</AdminLayoutShell>
    </>
  )
}
