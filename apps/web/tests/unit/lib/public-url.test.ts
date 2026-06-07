import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

import { resolveApiUrl } from '@/lib/public-url'
import { getSettings } from '@/lib/settings'

/** Minimal request stub exposing a `host` header. */
function req(host?: string) {
  return {
    headers: {
      get: (k: string) => (k.toLowerCase() === 'host' ? (host ?? null) : null),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveApiUrl', () => {
  it('uses the endpoint setting when set, preserving its protocol', async () => {
    vi.mocked(getSettings).mockResolvedValue({ endpoint: 'https://beta.lacrypta.ar' })
    expect(await resolveApiUrl(req('localhost:55067'))).toBe('https://beta.lacrypta.ar')
  })

  it('falls back to the request host when endpoint is empty — NOT the lightning domain', async () => {
    // The exact bug scenario: a public address domain is set but endpoint is not.
    vi.mocked(getSettings).mockResolvedValue({
      endpoint: '',
      domain: 'lacrypta.ar',
      subdomain: '',
    })
    expect(await resolveApiUrl(req('localhost:55067'))).toBe('http://localhost:55067')
  })

  it('defaults to localhost:3000 when neither endpoint nor host header is present', async () => {
    vi.mocked(getSettings).mockResolvedValue({})
    expect(await resolveApiUrl(req())).toBe('http://localhost:3000')
  })

  it('uses https for a non-local request host fallback', async () => {
    vi.mocked(getSettings).mockResolvedValue({ endpoint: '' })
    expect(await resolveApiUrl(req('app.example.com'))).toBe('https://app.example.com')
  })

  it('adds a scheme to a bare-host endpoint setting', async () => {
    vi.mocked(getSettings).mockResolvedValue({ endpoint: 'app.example.com' })
    expect(await resolveApiUrl(req('localhost:3000'))).toBe('https://app.example.com')
  })
})
