'use client'

import { useSettings } from '@/lib/client/hooks/use-settings'

/** Static LaWallet fallback used when no community logotype has been uploaded. */
export const DEFAULT_LOGOTYPE_SRC = '/logos/lawallet.svg'
/** Static LaWallet isotypo fallback. */
export const DEFAULT_ISOTYPO_SRC = '/logos/lawallet.svg'

/**
 * Resolved brand-logo URLs for the current community.
 *
 * Reads `logotype_url` / `isotypo_url` from `/api/settings` (which the public
 * GET exposes alongside the rest of the branding) and falls back to the
 * static LaWallet assets when the admin hasn't uploaded a logo yet.
 *
 * Safe to call from any client component; `useSettings()` is cached by the
 * shared API hook so this does not cause extra fetches.
 */
export function useBrandLogotypes() {
  const { data: settings } = useSettings()
  const logotype = settings?.logotype_url?.trim() || DEFAULT_LOGOTYPE_SRC
  const isotypo = settings?.isotypo_url?.trim() || DEFAULT_ISOTYPO_SRC
  return { logotype, isotypo }
}
