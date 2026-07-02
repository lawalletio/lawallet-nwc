import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Providers } from '@/app/providers'
import HomePage from '@/app/page'
import { clearApiCache } from '@/lib/client/hooks/use-api'
import { useSettings } from '@/lib/client/hooks/use-settings'

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: pushMock,
    back: vi.fn()
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams()
}))

vi.mock('@/components/landing/hero-section', () => ({
  HeroSection: ({
    domain,
    loading,
    setupNeeded
  }: {
    domain: string
    loading: boolean
    setupNeeded: boolean
  }) => (
    <div
      data-testid="hero"
      data-domain={domain}
      data-loading={String(loading)}
      data-setup-needed={String(setupNeeded)}
    />
  )
}))

vi.mock('@/components/landing/features-section', () => ({
  FeaturesSection: () => <section data-testid="features" />
}))

vi.mock('@/components/landing/showcase-section', () => ({
  ShowcaseSection: () => <section data-testid="showcase" />
}))

vi.mock('@/components/landing/cta-section', () => ({
  CtaSection: () => <section data-testid="cta" />
}))

vi.mock('@/components/landing/domain-cta', () => ({
  DomainCta: () => <section data-testid="domain-cta" />
}))

vi.mock('@/components/landing/footer', () => ({
  Footer: () => <footer data-testid="footer" />
}))

vi.mock('@/components/landing/claim-dialog', () => ({
  ClaimDialog: () => null
}))

vi.mock('@/components/admin/login-modal', () => ({
  LoginModal: () => null
}))

function settingsFetchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input]) => input === '/api/settings')
}

function setupStatusFetchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([input]) => input === '/api/setup/status')
}

function LateSettingsConsumer() {
  const { data: settings, loading } = useSettings()
  return (
    <div
      data-testid="late-settings"
      data-domain={settings?.domain ?? ''}
      data-loading={String(loading)}
    />
  )
}

function LandingHarness({ showLate = false }: { showLate?: boolean }) {
  return (
    <>
      <HomePage />
      {showLate && <LateSettingsConsumer />}
    </>
  )
}

describe('landing settings fetches', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clearApiCache()
    window.localStorage.clear()
    pushMock.mockReset()

    fetchMock = vi.fn(async input => {
      if (input === '/api/settings') {
        return new Response(
          JSON.stringify({
            domain: 'example.com',
            hasRoot: true,
            brand_theme: '#22c55e',
            brand_rounding: 'Medium',
            logotype_url: '/logos/lawallet.svg'
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }

      throw new Error(`Unexpected fetch: ${String(input)}`)
    })

    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    clearApiCache()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('shares one settings request across landing, theme, and brand consumers', async () => {
    const view = render(
      <Providers attribute="class" forcedTheme="dark">
        <LandingHarness />
      </Providers>
    )

    await waitFor(() => {
      expect(screen.getByTestId('hero')).toHaveAttribute(
        'data-domain',
        'example.com'
      )
      expect(screen.getByTestId('hero')).toHaveAttribute(
        'data-loading',
        'false'
      )
      expect(screen.getByTestId('hero')).toHaveAttribute(
        'data-setup-needed',
        'false'
      )
    })

    expect(settingsFetchCalls(fetchMock)).toHaveLength(1)
    expect(setupStatusFetchCalls(fetchMock)).toHaveLength(0)

    view.rerender(
      <Providers attribute="class" forcedTheme="dark">
        <LandingHarness showLate />
      </Providers>
    )

    await waitFor(() => {
      expect(screen.getByTestId('late-settings')).toHaveAttribute(
        'data-domain',
        'example.com'
      )
      expect(screen.getByTestId('late-settings')).toHaveAttribute(
        'data-loading',
        'false'
      )
    })

    expect(settingsFetchCalls(fetchMock)).toHaveLength(1)
    expect(setupStatusFetchCalls(fetchMock)).toHaveLength(0)
  })
})
