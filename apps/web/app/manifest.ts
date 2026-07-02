import type { MetadataRoute } from 'next'
import { getSettings } from '@/lib/settings'

// Dynamic web app manifest — white-label per operator. Name, theme color and
// icons come from the DB `Settings` so each domain installs with its own
// branding without a redeploy. The manifest is wallet-scoped: installing from
// any `/wallet` page lands the user straight in their wallet.
//
// Next links this automatically into every page's <head>. Reading settings
// makes the route dynamic; guard the build phase so `next build` (no DB) does
// not spam connection errors — the real values are fetched per request.
export const dynamic = 'force-dynamic'

async function loadBranding(): Promise<{
  name: string
  themeColor: string
  isotypeUrl: string | null
}> {
  const fallback = {
    name: 'LaWallet',
    themeColor: '#0a0a0a',
    isotypeUrl: null as string | null
  }
  if (process.env.NEXT_PHASE === 'phase-production-build') return fallback
  try {
    const settings = await getSettings(['community_name', 'isotypo_url', 'brand_theme'])
    return {
      name: settings.community_name?.trim() || fallback.name,
      themeColor: settings.brand_theme?.trim() || fallback.themeColor,
      isotypeUrl: settings.isotypo_url?.trim() || null
    }
  } catch {
    return fallback
  }
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { name, themeColor, isotypeUrl } = await loadBranding()

  // Bundled fallback icons (generated from the LaWallet isotype). When the
  // operator has set a custom isotype we prepend it as an "any"-purpose icon so
  // the OS can pick it, keeping the bundled maskable icon for adaptive shapes.
  const icons: MetadataRoute.Manifest['icons'] = []
  if (isotypeUrl) {
    icons.push({ src: isotypeUrl, sizes: 'any', purpose: 'any' })
  }
  icons.push(
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      src: '/icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable'
    }
  )

  return {
    name,
    short_name: name,
    description: 'Your Lightning wallet',
    start_url: '/wallet',
    scope: '/wallet',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0a0a',
    theme_color: themeColor,
    icons
  }
}
