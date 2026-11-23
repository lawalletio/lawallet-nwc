'use client'

import { useApi } from '@/lib/client/hooks/use-api'

export interface PluginStateRow {
  id: string
  name: string
  version: string
  description?: string
  enabled: boolean
}

/** Registered plugins with their enabled state (GET /api/plugins). */
export function usePlugins(enabled: boolean = true) {
  return useApi<{ plugins: PluginStateRow[] }>(enabled ? '/api/plugins' : null)
}
