'use client'

import { useApi, useMutation } from '@/lib/client/hooks/use-api'

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

/** Admin toggle (PATCH /api/plugins/[id]) — requires SETTINGS_WRITE. */
export function useTogglePlugin() {
  const { mutate, loading, error } = useMutation<
    { enabled: boolean },
    { id: string; enabled: boolean }
  >()

  return {
    toggle: (id: string, enabled: boolean) =>
      mutate('patch', `/api/plugins/${id}`, { enabled }),
    loading,
    error
  }
}
