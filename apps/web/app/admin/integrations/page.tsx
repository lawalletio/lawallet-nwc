'use client'

import React, { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { Permission } from '@/lib/auth/permissions'
import { useApi } from '@/lib/client/hooks/use-api'
import {
  IntegrationCard,
  type IntegrationState
} from '@/components/admin/integrations/integration-card'

interface IntegrationsResponse {
  secretsEncrypted: boolean
  integrations: IntegrationState[]
}

export default function IntegrationsPage() {
  const router = useRouter()
  const { status, isAuthorized } = useAuth()
  const allowed =
    status === 'authenticated' && isAuthorized(Permission.INTEGRATIONS_MANAGE)

  // Same bounce as Settings: the shell already handles signed-out users.
  useEffect(() => {
    if (status === 'authenticated' && !allowed) {
      toast.error('Only administrators can manage integrations.', {
        id: 'integrations-admin-only'
      })
      router.replace('/admin')
    }
  }, [status, allowed, router])

  const { data, loading, refetch } = useApi<IntegrationsResponse>(
    allowed ? '/api/integrations' : null
  )

  if (!allowed || (loading && !data)) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={24} />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Integrations"
        subtitle="Third-party services that add features to the wallet."
      />
      <div className="flex flex-col gap-4 px-4 py-6 sm:px-6 max-w-3xl">
        {data && !data.secretsEncrypted && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            NWC_VAULT_SECRET is not set, so API keys are stored unencrypted
            (still never sent to any client). Set it to encrypt them at rest.
          </p>
        )}
        {data?.integrations.map(it => (
          <IntegrationCard
            // Remount after a save so drafts re-hydrate from the server.
            key={`${it.id}:${it.enabled}:${JSON.stringify(it.values)}:${JSON.stringify(it.secretsConfigured)}`}
            integration={it}
            onSaved={refetch}
          />
        ))}
      </div>
    </div>
  )
}
