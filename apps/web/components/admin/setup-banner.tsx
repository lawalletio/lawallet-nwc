'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { useAuth } from '@/components/admin/auth-context'

export function SetupBanner() {
  const router = useRouter()
  const { role } = useAuth()
  const { data: settings, loading } = useSettings()

  const hasDomain = !!settings?.domain?.trim()
  const domainVerified = settings?.domain_verified === 'true'

  if (loading || role !== 'ADMIN' || (hasDomain && domainVerified)) return null

  return (
    <div
      role="alert"
      className="mx-4 mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 shadow-sm md:mx-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-md bg-amber-500/15 text-amber-500">
            <AlertTriangle className="size-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-semibold text-foreground">
              {hasDomain ? 'Domain verification required' : 'Domain configuration required'}
            </h3>
            <p className="text-sm text-muted-foreground">
              Verify .well-known routing so LNURL and NIP-05 discovery reach this instance.
            </p>
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => router.push('/admin/settings?tab=infrastructure&domainSetup=open')}
        >
          <Route className="mr-2 size-4" />
          Fix domain config
        </Button>
      </div>
    </div>
  )
}
