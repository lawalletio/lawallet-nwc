'use client'

import { useApi, useMutation } from '@/lib/client/hooks/use-api'

export interface SettingsData {
  domain?: string
  endpoint?: string
  subdomain?: string
  root?: string
  is_community?: string
  community_id?: string
  community_name?: string
  /** Brand theme color hex (matches one of THEME_PRESETS). */
  brand_theme?: string
  /** Brand rounding option: 'None' | 'Small' | 'Medium' | 'Full'. */
  brand_rounding?: string
  [key: string]: string | undefined
}

/**
 * Fetch current settings.
 */
export function useSettings() {
  return useApi<SettingsData>('/api/settings')
}

/**
 * Mutation hook for updating settings.
 */
export function useUpdateSettings() {
  const { mutate, loading, error } = useMutation<Record<string, string>>()

  return {
    updateSettings: (data: Record<string, string>) =>
      mutate('post', '/api/settings', data),
    loading,
    error,
  }
}
