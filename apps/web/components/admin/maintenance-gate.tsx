'use client'

import React from 'react'
import { Wrench } from 'lucide-react'
import { useAuth } from '@/components/admin/auth-context'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { Role } from '@/lib/auth/permissions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { BrandLogotype } from '@/components/ui/brand-logotype'

/**
 * Renders a full-page maintenance screen for non-admin users when the
 * `maintenance_enabled` setting is on. Admins continue to see the full
 * dashboard — with a banner at the top reminding them the platform is
 * currently locked down for everyone else — so they can toggle the flag
 * back off.
 *
 * Pairs with the server-side `checkMaintenance` middleware: every non-admin
 * API call is already returning 503, so blocking the UI here just prevents
 * the user from hitting a wall of error toasts.
 */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const { role, logout } = useAuth()
  const { data: settings } = useSettings()

  const maintenanceOn = settings?.maintenance_enabled === 'true'
  const isAdmin = role === Role.ADMIN

  if (!maintenanceOn) {
    return <>{children}</>
  }

  if (isAdmin) {
    return (
      <>
        <div className="sticky top-0 z-40 border-b border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-200">
          <div className="mx-auto flex max-w-5xl items-center gap-2">
            <Wrench className="size-4" aria-hidden />
            <span>
              Maintenance mode is <strong>on</strong>. Non-admin users are
              currently blocked from the dashboard and the API.
            </span>
          </div>
        </div>
        {children}
      </>
    )
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <BrandLogotype width={160} height={40} />
        <Alert className="border-yellow-500/40 bg-yellow-500/5 text-left">
          <Wrench className="size-4 text-yellow-400" />
          <AlertTitle>General maintenance</AlertTitle>
          <AlertDescription>
            The platform is temporarily unavailable while we perform
            maintenance. All wallet, address, and API functions are
            disabled until an administrator brings the service back up.
            Please check back shortly.
          </AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={logout}>
          Sign out
        </Button>
      </div>
    </div>
  )
}
