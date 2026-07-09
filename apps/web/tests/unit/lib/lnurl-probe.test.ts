import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  probeLightningAddressCapabilities,
  probeLud21Support,
} from '@/lib/lnurl-probe'

const originalFetch = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  global.fetch = originalFetch
})

function mockFetchSequence(handlers: Array<() => Partial<Response>>) {
  let i = 0
  global.fetch = vi.fn(async () => handlers[i++]() as Response) as any
}

describe('probeLud21Support', () => {
  it('resolves when metadata is payRequest, price in range, and callback returns verify', async () => {
    mockFetchSequence([
      () => ({
        ok: true,
        json: async () => ({
          tag: 'payRequest',
          callback: 'https://example.com/cb',
          minSendable: 1_000,
          maxSendable: 1_000_000_000,
        }),
      }),
      () => ({
        ok: true,
        json: async () => ({
          pr: 'lnbc1...',
          verify: 'https://example.com/verify/xyz',
        }),
      }),
    ])

    await expect(probeLud21Support('admin@example.com', 21)).resolves.toBeUndefined()
  })

  it('rejects when callback response omits verify URL', async () => {
    mockFetchSequence([
      () => ({
        ok: true,
        json: async () => ({
          tag: 'payRequest',
          callback: 'https://example.com/cb',
          minSendable: 1_000,
          maxSendable: 1_000_000_000,
        }),
      }),
      () => ({
        ok: true,
        json: async () => ({ pr: 'lnbc1...' }), // no verify
      }),
    ])

    await expect(probeLud21Support('admin@example.com', 21)).rejects.toThrow(
      /LUD-21 verify/i
    )
  })

  it('rejects when metadata tag is not payRequest', async () => {
    mockFetchSequence([
      () => ({
        ok: true,
        json: async () => ({ tag: 'withdrawRequest', callback: 'x' }),
      }),
    ])

    await expect(probeLud21Support('admin@example.com', 21)).rejects.toThrow(
      /LUD-16 payRequest/i
    )
  })

  it('rejects when price is outside the sendable range', async () => {
    mockFetchSequence([
      () => ({
        ok: true,
        json: async () => ({
          tag: 'payRequest',
          callback: 'https://example.com/cb',
          minSendable: 100_000_000, // 100_000 sats floor
          maxSendable: 1_000_000_000,
        }),
      }),
    ])

    await expect(probeLud21Support('admin@example.com', 21)).rejects.toThrow(
      /outside the sendable range/i
    )
  })

  it('rejects on network error reaching the metadata endpoint', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ENETUNREACH')
    }) as any

    await expect(probeLud21Support('admin@example.com', 21)).rejects.toThrow(
      /not reachable/i
    )
  })

  it('rejects on invalid lightning address format', async () => {
    await expect(probeLud21Support('not-an-address', 21)).rejects.toThrow(
      /Invalid lightning address/i
    )
  })

  it('rejects when provider returns HTTP 404 for metadata', async () => {
    mockFetchSequence([() => ({ ok: false, status: 404 })])

    await expect(probeLud21Support('admin@example.com', 21)).rejects.toThrow(
      /HTTP 404/
    )
  })
})

describe('probeLightningAddressCapabilities', () => {
  it('passes all checks when LUD-16, LUD-21, and NIP-57 are supported', async () => {
    mockFetchSequence([
      () => ({
        ok: true,
        json: async () => ({
          tag: 'payRequest',
          callback: 'https://example.com/cb',
          minSendable: 1_000,
          maxSendable: 1_000_000_000,
          allowsNostr: true,
          nostrPubkey: 'a'.repeat(64),
        }),
      }),
      () => ({
        ok: true,
        json: async () => ({
          pr: 'lnbc1...',
          verify: 'https://example.com/verify/xyz',
        }),
      }),
    ])

    const result = await probeLightningAddressCapabilities('Admin@Example.com')

    expect(result.address).toBe('admin@example.com')
    expect(result.canSave).toBe(true)
    expect(result.checks.lud16.ok).toBe(true)
    expect(result.checks.lud21.ok).toBe(true)
    expect(result.checks.nip57.ok).toBe(true)
  })

  it('blocks saving when LUD-16 metadata cannot be resolved', async () => {
    mockFetchSequence([() => ({ ok: false, status: 404 })])

    const result = await probeLightningAddressCapabilities('admin@example.com')

    expect(result.canSave).toBe(false)
    expect(result.checks.lud16.ok).toBe(false)
    expect(result.checks.lud16.message).toMatch(/HTTP 404/)
    expect(result.checks.lud21.ok).toBe(false)
    expect(result.checks.nip57.ok).toBe(false)
  })

  it('allows saving with warnings when optional LUD-21 and NIP-57 checks fail', async () => {
    mockFetchSequence([
      () => ({
        ok: true,
        json: async () => ({
          tag: 'payRequest',
          callback: 'https://example.com/cb',
          minSendable: 1_000,
          maxSendable: 1_000_000_000,
        }),
      }),
      () => ({
        ok: true,
        json: async () => ({ pr: 'lnbc1...' }),
      }),
    ])

    const result = await probeLightningAddressCapabilities('admin@example.com')

    expect(result.canSave).toBe(true)
    expect(result.checks.lud16.ok).toBe(true)
    expect(result.checks.lud21.ok).toBe(false)
    expect(result.checks.lud21.message).toMatch(/verify URL/)
    expect(result.checks.nip57.ok).toBe(false)
    expect(result.checks.nip57.message).toMatch(/NIP-57/)
  })
})
