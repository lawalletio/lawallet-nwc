'use client'

import { useEffect, useState } from 'react'
import { Award } from 'lucide-react'
import { useAuth } from '@/components/admin/auth-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { truncateNpub } from '@/lib/client/format'
import type { LawalletPluginClient } from '../_runtime/client-registry'

interface AwardRow {
  pubkey: string
  badge: string
  reason?: string
  awardedAt: string
}

function BadgesPage() {
  const { apiClient } = useAuth()
  const [awards, setAwards] = useState<AwardRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiClient
      .get<{ awards: AwardRow[] }>('/api/plugins/badges/awards')
      .then(res => setAwards(res.awards))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed'))
  }, [apiClient])

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Award className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Badges</h1>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {awards && awards.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No badges awarded yet. Badges are granted automatically on paid
          invoices, or via POST /api/plugins/badges/awards.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {awards?.map(a => (
          <Card key={`${a.pubkey}:${a.badge}`}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Award className="h-4 w-4" />
                {a.badge}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Badge variant="secondary">{truncateNpub(a.pubkey)}</Badge>
              {a.reason && (
                <p className="text-muted-foreground">{a.reason}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {new Date(a.awardedAt).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export const badgesPluginClient: LawalletPluginClient = {
  id: 'badges',
  navItems: [
    {
      title: 'Badges',
      href: '/admin/plugins/badges',
      icon: Award,
      group: 'platform'
    }
  ],
  Page: BadgesPage
}
