'use client'

import { Puzzle } from 'lucide-react'
import type { LawalletPluginClient } from '../_runtime/client-registry'

function __PLUGIN_CAMEL__Page() {
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">__PLUGIN_NAME__</h1>
      <p className="text-sm text-muted-foreground">
        Build your plugin UI here. Data comes from your plugin routes at
        /api/plugins/__PLUGIN_ID__/… via the authenticated apiClient
        (useAuth().apiClient).
      </p>
    </div>
  )
}

export const __PLUGIN_CAMEL__PluginClient: LawalletPluginClient = {
  id: '__PLUGIN_ID__',
  navItems: [
    {
      title: '__PLUGIN_NAME__',
      href: '/admin/plugins/__PLUGIN_ID__',
      icon: Puzzle,
      group: 'platform'
    }
  ],
  Page: __PLUGIN_CAMEL__Page
}
