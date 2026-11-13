'use client'

import { useSettings } from '@/lib/client/hooks/use-settings'

/** Swaps are offered while Bull Bitcoin or Wapu is enabled + configured. */
export function useSwapsEnabled() {
  const { data: settings, loading } = useSettings()
  return {
    loading: loading && !settings,
    enabled:
      settings?.integration_bullbitcoin === 'true' ||
      settings?.integration_wapu === 'true'
  }
}
