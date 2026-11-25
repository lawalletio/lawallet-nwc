// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ isTest: true, isDevelopment: false }))
}))
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn() }))

import {
  bip353Name,
  bip353Value,
  parseSilentPaymentAddress
} from '@/lib/silent-payments'

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
