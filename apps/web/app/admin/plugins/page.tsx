'use client'

import { Puzzle } from 'lucide-react'
import { usePlugins, useTogglePlugin } from '@/lib/client/hooks/use-plugins'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

/**
 * Admin plugin management: list every registered plugin with an
 * enable/disable switch. The PATCH endpoint is SETTINGS_WRITE-gated
 * server-side; the sidebar already hides this page from non-admins.
 */
export default function PluginsPage() {
  const { data, loading, refetch } = usePlugins()
  const { toggle, loading: toggling } = useTogglePlugin()

  async function onToggle(id: string, enabled: boolean) {
    try {
      await toggle(id, enabled)
      toast.success(`${id} ${enabled ? 'enabled' : 'disabled'}`)
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Toggle failed')
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Puzzle className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Plugins</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Plugins extend the platform without touching core code — see
        docs/PLUGINS.md for how to build one.
      </p>

      {loading && !data && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {data?.plugins.map(plugin => (
          <Card key={plugin.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  {plugin.name}
                  <Badge variant="outline">v{plugin.version}</Badge>
                </span>
                <Switch
                  checked={plugin.enabled}
                  disabled={toggling}
                  onCheckedChange={checked => onToggle(plugin.id, checked)}
                />
              </CardTitle>
            </CardHeader>
            {plugin.description && (
              <CardContent className="text-sm text-muted-foreground">
                {plugin.description}
              </CardContent>
            )}
          </Card>
        ))}
        {data && data.plugins.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No plugins registered.
          </p>
        )}
      </div>
    </div>
  )
}
