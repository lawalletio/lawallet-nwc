'use client'

import { useApi, useMutation } from '@/lib/client/hooks/use-api'

export interface SettingsData {
  domain?: string
  domain_verified?: string
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
  /** Absolute URL to the Blossom-hosted community profile cover image. */
  community_cover_url?: string
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
  /** Whether non-admin users can create Lightning Addresses. Defaults to true when absent. */
  registration_user_enabled?: string
  registration_ln_address?: string
  registration_price?: string
  registration_ln_enabled?: string
  registration_admin_bypass?: string
  /** LNCurl disposable-wallet integration. All persisted as 'true' / 'false' strings except the URL. */
  lncurl_enabled?: string
  /** LNCurl provider base URL (default `https://lncurl.lol/`). */
  lncurl_server_url?: string
  /** Provision an LNCurl wallet as the default for every new account at signup. */
  lncurl_auto_create?: string
  /** When an LNCurl wallet is destroyed, mint a replacement on the next incoming payment. */
  lncurl_auto_recreate?: string
  /** Google Tag ID (e.g. `G-XXXXXXXXXX`). Empty string disables analytics. */
  gtag_id?: string
  [key: string]: string | undefined
}

/**
 * Fetch current settings.
 */
export function useSettings(enabled = true) {
  return useApi<SettingsData>(enabled ? '/api/settings' : null)
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
