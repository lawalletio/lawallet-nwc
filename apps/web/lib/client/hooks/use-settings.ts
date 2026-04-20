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
  /** JSON-stringified array of Nostr relay URLs (e.g. `["wss://relay.damus.io"]`). */
  relays?: string
  /** JSON-stringified array of Blossom media server URLs. */
  blossom_servers?: string
  /** Absolute URL to the Blossom-hosted logotype (wide brand mark). */
  logotype_url?: string
  /** Absolute URL to the Blossom-hosted isotypo (square icon). */
  isotypo_url?: string
  /** SMTP server hostname (no protocol, e.g. `smtp.example.com`). */
  smtp_host?: string
  smtp_port?: string
  smtp_username?: string
  smtp_password?: string
  /** Social media handles / URLs surfaced on the branding tab. */
  social_whatsapp?: string
  social_telegram?: string
  social_discord?: string
  social_twitter?: string
  social_website?: string
  social_nostr?: string
  social_email?: string
  /** Feature toggles persisted as the strings 'true' / 'false'. */
  wallet_enabled?: string
  maintenance_enabled?: string
  disable_transfers?: string
  disable_registers?: string
  disable_address?: string
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
