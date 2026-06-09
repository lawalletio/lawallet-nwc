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
      className="flex items-center justify-center gap-3 bg-amber-400 px-3 py-1 text-xs font-semibold text-black"
    >
      <AlertTriangle className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {hasDomain ? 'Domain verification required' : 'Domain configuration required'}: verify .well-known routing.
      </span>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 rounded px-2 text-xs font-semibold text-black hover:bg-black/10 hover:text-black"
        onClick={() => router.push('/admin/settings?tab=infrastructure&domainSetup=open')}
      >
        <Route className="mr-1.5 size-3.5" />
        Fix domain
      </Button>
    </div>
  )
}
