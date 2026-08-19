import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

import { resolveApiUrl, resolveAddressDomain } from '@/lib/public-url'
import { getSettings } from '@/lib/settings'

/** Minimal request stub exposing a `host` header. */
function req(host?: string) {
  return {
    headers: {
      get: (k: string) => (k.toLowerCase() === 'host' ? (host ?? null) : null)
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveApiUrl', () => {
  it('uses the endpoint setting when set, preserving its protocol', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      endpoint: 'https://beta.lacrypta.ar'
    })
    expect(await resolveApiUrl(req('localhost:55067'))).toBe(
      'https://beta.lacrypta.ar'
    )
  })

  it('falls back to the request host when endpoint is empty — NOT the lightning domain', async () => {
    // The exact bug scenario: a public address domain is set but endpoint is not.
    vi.mocked(getSettings).mockResolvedValue({
      endpoint: '',
      domain: 'lacrypta.ar'
    })
    expect(await resolveApiUrl(req('localhost:55067'))).toBe(
      'http://localhost:55067'
    )
  })

  it('defaults to localhost:3000 when neither endpoint nor host header is present', async () => {
    vi.mocked(getSettings).mockResolvedValue({})
    expect(await resolveApiUrl(req())).toBe('http://localhost:3000')
  })

  it('uses https for a non-local request host fallback', async () => {
    vi.mocked(getSettings).mockResolvedValue({ endpoint: '' })
    expect(await resolveApiUrl(req('app.example.com'))).toBe(
      'https://app.example.com'
    )
  })

  it('adds a scheme to a bare-host endpoint setting', async () => {
    vi.mocked(getSettings).mockResolvedValue({ endpoint: 'app.example.com' })
    expect(await resolveApiUrl(req('localhost:3000'))).toBe(
      'https://app.example.com'
    )
  })
})

describe('resolveAddressDomain', () => {
  it('uses the domain setting even when endpoint is a different host', async () => {
    // The exact bug scenario: text/identifier must say the domain, not the API host.
    vi.mocked(getSettings).mockResolvedValue({
      domain: 'lawallet.io',
      endpoint: 'https://beta.lawallet.io'
    })
    expect(await resolveAddressDomain(req('beta.lawallet.io'))).toBe(
      'lawallet.io'
    )
  })

  it('uses the domain setting verbatim as the address host', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      domain: 'app.lacrypta.ar',
      endpoint: ''
    })
    expect(await resolveAddressDomain(req())).toBe('app.lacrypta.ar')
  })

  it('falls back to the endpoint host when domain is unset', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      domain: '',
      endpoint: 'https://beta.lacrypta.ar'
    })
    expect(await resolveAddressDomain(req('localhost:55067'))).toBe(
      'beta.lacrypta.ar'
    )
  })

  it('falls back to the request host when neither domain nor endpoint is set', async () => {
    vi.mocked(getSettings).mockResolvedValue({})
    expect(await resolveAddressDomain(req('localhost:55067'))).toBe(
      'localhost:55067'
    )
  })

  it('defaults to localhost:3000 as the last resort', async () => {
    vi.mocked(getSettings).mockResolvedValue({})
    expect(await resolveAddressDomain(req())).toBe('localhost:3000')
  })
})
