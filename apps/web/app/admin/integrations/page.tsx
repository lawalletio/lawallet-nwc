'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Search, SearchX } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/components/admin/auth-context'
import { Permission } from '@/lib/auth/permissions'
import { useApi } from '@/lib/client/hooks/use-api'
import {
  IntegrationCard,
  KIND_LABEL,
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
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = data?.integrations ?? []
    if (!q) return all
    return all.filter(it =>
      [it.name, it.description, it.kind, KIND_LABEL[it.kind]].some(s =>
        s.toLowerCase().includes(q)
      )
    )
  }, [data, query])

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
      <div className="flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        {data && !data.secretsEncrypted && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            NWC_VAULT_SECRET is not set, so API keys are stored unencrypted
            (still never sent to any client). Set it to encrypt them at rest.
          </p>
        )}
        <div className="relative w-full sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search integrations"
            placeholder="Search integrations…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {visible.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map(it => (
              <IntegrationCard key={it.id} integration={it} onSaved={refetch} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
            <SearchX aria-hidden className="size-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                No integrations match “{query.trim()}”
              </p>
              <p className="text-xs text-muted-foreground">
                Try a name, or a kind like “DNS” or “cash-out”.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setQuery('')}>
              Clear search
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
