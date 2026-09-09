import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

import { fetchVoucherStatus } from '@/lib/vouchers/status'
import { assertServiceUrl } from '@/lib/vouchers/url'
import { ValidationError } from '@/types/server/errors'

const NONCE = 'hcLPDzERvvHzS4Vn0OLbAQ'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('assertServiceUrl', () => {
  it('accepts https', () => {
    expect(assertServiceUrl('https://example.com/claim', 'claimUrl').host).toBe(
      'example.com'
    )
  })

  it('rejects credentials in the URL', () => {
    expect(() =>
      assertServiceUrl('https://u:p@example.com/claim', 'claimUrl')
    ).toThrow(/must not contain credentials/)
  })

  it('rejects a non-http(s) scheme outright', () => {
    expect(() => assertServiceUrl('file:///etc/passwd', 'claimUrl')).toThrow(
      ValidationError
    )
    expect(() => assertServiceUrl('javascript:alert(1)', 'claimUrl')).toThrow(
      ValidationError
    )
  })

  it('allows plain http in development but not in production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(() =>
      assertServiceUrl('http://localhost:4000/claim', 'claimUrl')
    ).not.toThrow()

    vi.stubEnv('NODE_ENV', 'production')
    expect(() =>
      assertServiceUrl('http://merchant.example.com/claim', 'claimUrl')
    ).toThrow(/must use https/)
  })
})

describe('fetchVoucherStatus', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
  })

  it('refuses a loopback host in production', async () => {
    await expect(
      fetchVoucherStatus({
        claimUrl: 'https://localhost/api/coupons/claim',
        nonce: NONCE
      })
    ).rejects.toThrow(/private network/)
  })

  it('refuses a literal private address in production', async () => {
    await expect(
      fetchVoucherStatus({
        claimUrl: 'https://127.0.0.1/api/coupons/claim',
        nonce: NONCE
      })
    ).rejects.toThrow(/private network/)
    await expect(
      fetchVoucherStatus({
        claimUrl: 'https://10.0.0.5/api/coupons/claim',
        nonce: NONCE
      })
    ).rejects.toThrow(/private network/)
    // Link-local — the cloud metadata endpoint.
    await expect(
      fetchVoucherStatus({
        claimUrl: 'https://169.254.169.254/latest/meta-data',
        nonce: NONCE
      })
    ).rejects.toThrow(/private network/)
  })

  it('refuses a non-https claim URL in production before any lookup', async () => {
    await expect(
      fetchVoucherStatus({
        claimUrl: 'http://merchant.example.com/claim',
        nonce: NONCE
      })
    ).rejects.toThrow(/must use https/)
  })
})
