import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/font/google', () => ({ Inter: () => ({ className: '' }) }))
vi.mock('@vercel/speed-insights/next', () => ({ SpeedInsights: () => null }))
vi.mock('@/app/providers', () => ({ Providers: () => null }))
vi.mock('@/components/analytics/google-analytics', () => ({
  GoogleAnalytics: () => null
}))
vi.mock('@/components/dev-banner', () => ({ DevBanner: () => null }))
vi.mock('@/components/treasure-chest-preload', () => ({
  TreasureChestPreload: () => null
}))
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({})
}))

import RootLayout, { metadata } from '@/app/layout'
import GlobalError from '@/app/global-error'

// Google Translate mutating React-owned DOM crashes navigation
// (Sentry LAWALLET-WEB-T/S/F/V). Both <html> roots must opt out.
describe('page translation is disabled', () => {
  it('root layout emits the google notranslate meta', () => {
    expect(metadata.other).toMatchObject({ google: 'notranslate' })
  })

  it('root layout renders <html translate="no">', async () => {
    const html = await RootLayout({ children: null })
    expect(html.props.translate).toBe('no')
  })

  it('global error renders <html translate="no">', () => {
    const markup = renderToStaticMarkup(
      <GlobalError error={new Error('x')} reset={() => {}} />
    )
    expect(markup).toContain('<html lang="en" translate="no">')
  })
})
