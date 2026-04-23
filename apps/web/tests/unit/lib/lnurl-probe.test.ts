import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { probeLud21Support } from '@/lib/lnurl-probe'

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
