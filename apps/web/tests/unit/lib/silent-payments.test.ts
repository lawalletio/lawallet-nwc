// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ isTest: true, isDevelopment: false }))
}))
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn() }))
vi.mock('@/lib/public-url', () => ({
  resolveAddressDomain: vi.fn(async () => 'example.com:3000')
}))
vi.mock('@/lib/integrations/dns-provider', () => {
  const provider = { setTxt: vi.fn(), deleteTxt: vi.fn(), test: vi.fn() }
  return {
    provider,
    cloudflareDns: vi.fn(() => provider),
    vercelDns: vi.fn(() => provider)
  }
})

import {
  bip353Name,
  bip353Value,
  getActiveDnsProvider,
  parseSilentPaymentAddress,
  publishSilentPayment,
  unpublishSilentPayment
} from '@/lib/silent-payments'
import { getSettings } from '@/lib/settings'
import * as dns from '@/lib/integrations/dns-provider'

const provider = (dns as unknown as { provider: dns.DnsProvider }).provider

// BIP-352 test vector (simple send, receiving address).
const SP =
  'sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv'

describe('parseSilentPaymentAddress', () => {
  it('accepts a BIP-352 address and normalizes case/whitespace', () => {
    expect(parseSilentPaymentAddress(`  ${SP.toUpperCase()} `)).toBe(SP)
  })

  it.each([
    ['bad checksum', SP.slice(0, -1) + (SP.endsWith('q') ? 'p' : 'q')],
    ['wrong prefix', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'],
    ['garbage', 'sp1notanaddress']
  ])('rejects %s', (_, input) => {
    expect(() => parseSilentPaymentAddress(input)).toThrow(
      /Not a valid silent payment address/
    )
  })
})

describe('BIP-353 record', () => {
  it('builds the name and the BIP-321 value', () => {
    expect(bip353Name('alice', 'example.com')).toBe(
      'alice.user._bitcoin-payment.example.com'
    )
    expect(bip353Value(SP)).toBe(`bitcoin:?sp=${SP}`)
  })
})

describe('getActiveDnsProvider', () => {
  const ready = {
    silent_payments_enabled: 'true',
    silent_payments_dns_provider: 'vercel_dns',
    vercel_dns_enabled: 'true',
    vercel_dns_token: 'tok'
  }

  it('is null while the feature is off', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...ready,
      silent_payments_enabled: 'false'
    })
    expect(await getActiveDnsProvider()).toBeNull()
  })

  it('is null when the provider is not a DNS integration', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...ready,
      silent_payments_dns_provider: 'wapu'
    })
    expect(await getActiveDnsProvider()).toBeNull()
  })

  it('is null when the integration is disabled', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...ready,
      vercel_dns_enabled: 'false'
    })
    expect(await getActiveDnsProvider()).toBeNull()
  })

  it('builds Vercel with the instance domain (port stripped) as the zone', async () => {
    vi.mocked(getSettings).mockResolvedValue(ready)
    expect(await getActiveDnsProvider()).toBe(provider)
    expect(dns.vercelDns).toHaveBeenCalledWith({
      token: 'tok',
      teamId: undefined,
      zone: 'example.com'
    })
  })

  it('builds Cloudflare from its zone id', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      silent_payments_enabled: 'true',
      silent_payments_dns_provider: 'cloudflare_dns',
      cloudflare_dns_enabled: 'true',
      cloudflare_dns_token: 'tok',
      cloudflare_dns_zone_id: 'z1'
    })
    expect(await getActiveDnsProvider()).toBe(provider)
    expect(dns.cloudflareDns).toHaveBeenCalledWith({
      token: 'tok',
      zoneId: 'z1'
    })
  })
})

describe('publish / unpublish', () => {
  it('writes and deletes the BIP-353 record on the instance domain', async () => {
    vi.mocked(getSettings).mockResolvedValue({
      silent_payments_enabled: 'true',
      silent_payments_dns_provider: 'vercel_dns',
      vercel_dns_enabled: 'true',
      vercel_dns_token: 'tok'
    })
    await publishSilentPayment('alice', SP)
    expect(provider.setTxt).toHaveBeenCalledWith(
      'alice.user._bitcoin-payment.example.com',
      `bitcoin:?sp=${SP}`
    )
    await unpublishSilentPayment('alice')
    expect(provider.deleteTxt).toHaveBeenCalledWith(
      'alice.user._bitcoin-payment.example.com'
    )
  })

  it('throws 409 when the feature is off', async () => {
    vi.mocked(getSettings).mockResolvedValue({})
    await expect(publishSilentPayment('alice', SP)).rejects.toMatchObject({
      statusCode: 409
    })
  })
})
