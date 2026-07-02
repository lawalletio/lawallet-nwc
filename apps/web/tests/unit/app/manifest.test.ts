import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

import manifest from '@/app/manifest'
import { getSettings } from '@/lib/settings'

const mockSettings = (values: Record<string, string>) =>
  vi.mocked(getSettings).mockResolvedValue(values)

describe('web app manifest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is scoped to the wallet and installs standalone', async () => {
    mockSettings({})
    const m = await manifest()
    expect(m.start_url).toBe('/wallet')
    expect(m.scope).toBe('/wallet')
    expect(m.display).toBe('standalone')
  })

  it('falls back to default branding when settings are empty', async () => {
    mockSettings({})
    const m = await manifest()
    expect(m.name).toBe('LaWallet')
    expect(m.theme_color).toBe('#0a0a0a')
  })

  it('uses operator branding when present', async () => {
    mockSettings({ community_name: 'Acme Sats', brand_theme: '#ec4899' })
    const m = await manifest()
    expect(m.name).toBe('Acme Sats')
    expect(m.short_name).toBe('Acme Sats')
    expect(m.theme_color).toBe('#ec4899')
  })

  it('always ships bundled icons including a maskable one', async () => {
    mockSettings({})
    const m = await manifest()
    const purposes = (m.icons ?? []).map(i => i.purpose)
    expect(purposes).toContain('maskable')
    expect((m.icons ?? []).some(i => i.src === '/icons/icon-192.png')).toBe(true)
  })

  it('prepends a custom isotype ahead of the bundled icons', async () => {
    mockSettings({ isotypo_url: 'https://cdn.example/iso.png' })
    const m = await manifest()
    expect(m.icons?.[0].src).toBe('https://cdn.example/iso.png')
    // Bundled icons still present as fallbacks.
    expect((m.icons ?? []).length).toBeGreaterThan(1)
  })

  it('degrades to fallback branding when settings lookup throws', async () => {
    vi.mocked(getSettings).mockRejectedValue(new Error('db down'))
    const m = await manifest()
    expect(m.name).toBe('LaWallet')
    expect(m.icons?.length).toBeGreaterThan(0)
  })
})
