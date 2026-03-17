'use client'

import React, { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { PermissionGuard } from '@/components/admin/permission-guard'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Permission } from '@/lib/auth/permissions'
import { useAuth } from '@/components/admin/auth-context'
import { useSettings, useUpdateSettings } from '@/lib/client/hooks/use-settings'

export default function SettingsPage() {
  const { isAuthorized } = useAuth()
  const { data: settings, loading, refetch } = useSettings()
  const { updateSettings, loading: saving } = useUpdateSettings()
  const canWrite = isAuthorized(Permission.SETTINGS_WRITE)

  const [form, setForm] = useState({
    domain: '',
    endpoint: '',
    is_community: 'false',
    community_id: '',
  })

  // Populate form when settings load
  useEffect(() => {
    if (settings) {
      setForm({
        domain: settings.domain || '',
        endpoint: settings.endpoint || '',
        is_community: settings.is_community || 'false',
        community_id: settings.community_id || '',
      })
    }
  }, [settings])

  async function handleSave() {
    try {
      await updateSettings(form)
      toast.success('Settings saved')
      refetch()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save settings')
    }
  }

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title="Settings"
        subtitle="Configure your LaWallet instance"
        actions={
          canWrite ? (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 size-4" />
                  Save Changes
                </>
              )}
            </Button>
          ) : undefined
        }
      />

      <div className="p-6 flex flex-col gap-6 max-w-2xl">
        {loading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-48 w-full rounded-lg" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
        ) : (
          <>
            {/* Domain Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Domain Configuration</CardTitle>
                <CardDescription>
                  Configure the domain and endpoint for your LaWallet instance.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="domain">Domain</Label>
                  <Input
                    id="domain"
                    value={form.domain}
                    onChange={(e) => updateField('domain', e.target.value)}
                    placeholder="example.com"
                    disabled={!canWrite}
                  />
                  <p className="text-xs text-muted-foreground">
                    The domain used for Lightning Addresses (user@domain)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="endpoint">Endpoint</Label>
                  <Input
                    id="endpoint"
                    value={form.endpoint}
                    onChange={(e) => updateField('endpoint', e.target.value)}
                    placeholder="https://api.example.com"
                    disabled={!canWrite}
                  />
                  <p className="text-xs text-muted-foreground">
                    The API endpoint URL for LNURL callbacks
                  </p>
                </div>
              </CardContent>
            </Card>

            <Separator />

            {/* Community Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Community</CardTitle>
                <CardDescription>
                  Configure community mode for shared instances.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Community Mode</Label>
                    <p className="text-xs text-muted-foreground">
                      Enable if this instance is managed by a community
                    </p>
                  </div>
                  <Switch
                    checked={form.is_community === 'true'}
                    onCheckedChange={(checked) =>
                      updateField('is_community', checked ? 'true' : 'false')
                    }
                    disabled={!canWrite}
                  />
                </div>

                {form.is_community === 'true' && (
                  <div className="space-y-2">
                    <Label htmlFor="community-id">Community ID</Label>
                    <Input
                      id="community-id"
                      value={form.community_id}
                      onChange={(e) => updateField('community_id', e.target.value)}
                      placeholder="community-identifier"
                      disabled={!canWrite}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Root Admin (read-only) */}
            {settings?.root && (
              <>
                <Separator />
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Root Administrator</CardTitle>
                    <CardDescription>
                      The root admin pubkey for this instance.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <code className="text-xs font-mono bg-muted px-2 py-1 rounded break-all">
                      {settings.root}
                    </code>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
