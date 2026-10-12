import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/font/google', () => ({ Inter: () => ({ className: '' }) }))
vi.mock('@vercel/speed-insights/next', () => ({ SpeedInsights: () => null }))
vi.mock('@/app/providers', () => ({ Providers: () => null }))
vi.mock('@/components/dev-banner', () => ({ DevBanner: () => null }))

import RootLayout, { metadata } from '@/app/layout'
import GlobalError from '@/app/global-error'

// Google Translate mutating React-owned DOM crashes navigation
// (Sentry LAWALLET-WEB-T/S/F/V). Both <html> roots must opt out.
describe('page translation is disabled', () => {
  it('root layout emits the google notranslate meta', () => {
    expect(metadata.other).toMatchObject({ google: 'notranslate' })
  })

  it('root layout renders <html translate="no">', () => {
    const html = RootLayout({ children: null })
    expect(html.props.translate).toBe('no')
  })

  it('global error renders <html translate="no">', () => {
    const markup = renderToStaticMarkup(
      <GlobalError error={new Error('x')} reset={() => {}} />
    )
    expect(markup).toContain('<html lang="en" translate="no">')
  })
})

describe('root layout first paint', () => {
  const markup = renderToStaticMarkup(RootLayout({ children: null }))

  it('applies the stored theme from an inline <head> script', () => {
    expect(markup).toMatch(/<head><script>\(function\(\)\{try\{/)
    expect(markup).toContain('lawallet-theme-color')
  })

  it('no longer preloads the claim chest on every route', () => {
    expect(markup).not.toContain('treasure-chest.lottie')
  })
})
