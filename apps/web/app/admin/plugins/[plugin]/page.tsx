'use client'

import { use } from 'react'
import { getPluginClient } from '@/plugins/client'
import { usePlugins } from '@/lib/client/hooks/use-plugins'

/**
 * Core page host for plugin UI: /admin/plugins/<id> renders the plugin's
 * registered Page component — plugins get a full admin page without adding
 * any route files to core. Disabled or unknown plugins show a fallback.
 */
export default function PluginPage({
  params
}: {
  params: Promise<{ plugin: string }>
}) {
  const { plugin: pluginId } = use(params)
  const { data, loading } = usePlugins()

  const client = getPluginClient(pluginId)
  const state = data?.plugins.find(p => p.id === pluginId)

  if (loading && !data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }

  if (!client?.Page || !state?.enabled) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Plugin “{pluginId}” is not enabled.
      </div>
    )
  }

  const Page = client.Page
  return <Page />
}
