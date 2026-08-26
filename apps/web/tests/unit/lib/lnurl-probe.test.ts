import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  probeLightningAddressCapabilities,
  probeLud21Support,
  resolveInvoice
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
          maxSendable: 1_000_000_000
        })
      }),
      () => ({
        ok: true,
        json: async () => ({
          pr: 'lnbc1...',
          verify: 'https://example.com/verify/xyz'
        })
      })
    ])

    await expect(
      probeLud21Support('admin@example.com', 21)
    ).resolves.toBeUndefined()
  })

  it('rejects when callback response omits verify URL', async () => {
    mockFetchSequence([
      () => ({
        ok: true,
        json: async () => ({
          tag: 'payRequest',
          callback: 'https://example.com/cb',
          minSendable: 1_000,
          maxSendable: 1_000_000_000
        })
      }),
      () => ({
        ok: true,
        json: async () => ({ pr: 'lnbc1...' }) // no verify
      })
    ])

    await expect(probeLud21Support('admin@example.com', 21)).rejects.toThrow(
      /LUD-21 verify/i
    )
  })

  it('rejects when metadata tag is not payRequest', async () => {
    mockFetchSequence([
      () => ({
        ok: true,
        json: async () => ({ tag: 'withdrawRequest', callback: 'x' })
      })
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
          maxSendable: 1_000_000_000
        })
      })
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
          nostrPubkey: 'a'.repeat(64)
        })
      }),
      () => ({
        ok: true,
        json: async () => ({
          pr: 'lnbc1...',
          verify: 'https://example.com/verify/xyz'
        })
      })
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
          maxSendable: 1_000_000_000
        })
      }),
      () => ({
        ok: true,
        json: async () => ({ pr: 'lnbc1...' })
      })
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

describe('resolveInvoice', () => {
  function metadataResponse(extra: Record<string, unknown> = {}) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tag: 'payRequest',
        callback: 'https://example.com/cb',
        minSendable: 1_000,
        maxSendable: 1_000_000_000,
        ...extra
      })
    }
  }

  const invoiceResponse = {
    ok: true,
    status: 200,
    json: async () => ({
      pr: 'lnbc210n1test',
      verify: 'https://example.com/verify/xyz'
    })
  }

  function calledUrls(): string[] {
    return vi.mocked(global.fetch).mock.calls.map(call => String(call[0]))
  }

  it('omits the comment when the provider advertises no LUD-12 budget', async () => {
    mockFetchSequence([() => metadataResponse(), () => invoiceResponse])

    await expect(
      resolveInvoice('admin@example.com', 21, 'LaWallet address: alice')
    ).resolves.toEqual({
      bolt11: 'lnbc210n1test',
      verify: 'https://example.com/verify/xyz'
    })

    // Sending `comment` to a provider that never advertised `commentAllowed`
    // is what made real providers answer HTTP 400 mid-registration.
    expect(calledUrls()[1]).not.toContain('comment=')
  })

  it('truncates the comment to the advertised commentAllowed budget', async () => {
    mockFetchSequence([
      () => metadataResponse({ commentAllowed: 10 }),
      () => invoiceResponse
    ])

    await resolveInvoice('admin@example.com', 21, 'LaWallet address: alice')

    expect(calledUrls()[1]).toContain(
      `comment=${encodeURIComponent('LaWallet a')}`
    )
  })

  it('retries the callback once when the provider times out', async () => {
    let call = 0
    global.fetch = vi.fn(async () => {
      call++
      if (call === 1) return metadataResponse() as Response
      if (call === 2) throw new Error('This operation was aborted')
      return invoiceResponse as Response
    }) as any

    await expect(
      resolveInvoice('admin@example.com', 21, 'LaWallet address: alice')
    ).resolves.toMatchObject({ bolt11: 'lnbc210n1test' })
    expect(call).toBe(3)
  })

  it('gives up with the provider error once the retries are spent', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/.well-known/')) {
        return metadataResponse() as Response
      }
      throw new Error('This operation was aborted')
    }) as any

    await expect(
      resolveInvoice('admin@example.com', 21, 'LaWallet address: alice')
    ).rejects.toThrow(/callback failed/i)
  })

  it('does not retry a provider verdict (HTTP 400)', async () => {
    let callbackCalls = 0
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/.well-known/')) {
        return metadataResponse() as Response
      }
      callbackCalls++
      return { ok: false, status: 400, text: async () => '' } as Response
    }) as any

    await expect(
      resolveInvoice('admin@example.com', 21, 'LaWallet address: alice')
    ).rejects.toThrow(/HTTP 400/)
    expect(callbackCalls).toBe(1)
  })

  it("carries the provider's own reason into the error message", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/.well-known/')) {
        return metadataResponse() as Response
      }
      return {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({ status: 'ERROR', reason: 'Amount not allowed' })
      } as Response
    }) as any

    // Without this an operator only sees "returned HTTP 400" and cannot tell
    // a rejected amount from a rejected comment from a disabled account.
    await expect(
      resolveInvoice('admin@example.com', 21, 'LaWallet address: alice')
    ).rejects.toThrow(/HTTP 400: Amount not allowed/)
  })
})
