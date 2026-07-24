import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { bech32 } from 'bech32'
import {
  lnurlToHttpUrl,
  looksLikeLnurl,
  resolveLnurl,
  submitLnurlWithdraw,
  LnurlError,
} from '@/lib/client/lnurl-scan'

const originalFetch = global.fetch

function encodeLnurl(url: string): string {
  const words = bech32.toWords(new TextEncoder().encode(url))
  return bech32.encode('lnurl', words, 2048)
}

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  global.fetch = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  global.fetch = originalFetch
})

describe('lnurlToHttpUrl', () => {
  it('decodes a bech32 lnurl1 to its https URL', () => {
    const url = 'https://example.com/lnurl/withdraw?tag=withdrawRequest'
    expect(lnurlToHttpUrl(encodeLnurl(url))).toBe(url)
  })

  it('maps lnurlw:// to https', () => {
    expect(lnurlToHttpUrl('lnurlw://example.com/wd?k1=abc')).toBe(
      'https://example.com/wd?k1=abc',
    )
  })

  it('maps a .onion pseudo-scheme host to http', () => {
    expect(lnurlToHttpUrl('lnurlw://abcd.onion/wd')).toBe(
      'http://abcd.onion/wd',
    )
  })

  it('strips a lightning: prefix', () => {
    const url = 'https://example.com/lnurl?tag=payRequest'
    expect(lnurlToHttpUrl(`lightning:${encodeLnurl(url)}`)).toBe(url)
  })

  it('passes a plain http(s) URL through', () => {
    expect(lnurlToHttpUrl('https://example.com/x?tag=withdrawRequest')).toBe(
      'https://example.com/x?tag=withdrawRequest',
    )
  })

  it('returns null for non-LNURL inputs', () => {
    expect(lnurlToHttpUrl('lnbc1abcdef')).toBeNull()
    expect(lnurlToHttpUrl('satoshi@example.com')).toBeNull()
    expect(lnurlToHttpUrl('')).toBeNull()
  })
})

describe('looksLikeLnurl', () => {
  it('is true for lnurl1 / pseudo-schemes / tagged URLs', () => {
    expect(looksLikeLnurl(encodeLnurl('https://x.com/a'))).toBe(true)
    expect(looksLikeLnurl('lnurlw://x.com/wd')).toBe(true)
    expect(looksLikeLnurl('https://x.com/a?tag=withdrawRequest')).toBe(true)
    expect(looksLikeLnurl('https://x.com/a?tag=payRequest')).toBe(true)
    expect(looksLikeLnurl('https://x.com/a?k1=deadbeef')).toBe(true)
  })

  it('is false for plain websites, addresses, and invoices', () => {
    expect(looksLikeLnurl('https://example.com/blog/post')).toBe(false)
    expect(looksLikeLnurl('satoshi@example.com')).toBe(false)
    expect(looksLikeLnurl('lnbc1abcdef')).toBe(false)
    expect(looksLikeLnurl('not a url')).toBe(false)
  })
})

describe('resolveLnurl', () => {
  it('classifies a withdrawRequest and converts msat→sat', async () => {
    mockFetchOnce({
      tag: 'withdrawRequest',
      callback: 'https://example.com/wd/callback',
      k1: 'secret-k1',
      defaultDescription: 'Voucher #1',
      minWithdrawable: 2000,
      maxWithdrawable: 50000,
    })

    const resolved = await resolveLnurl('lnurlw://example.com/wd')
    expect(resolved).toEqual({
      kind: 'withdraw',
      params: {
        callback: 'https://example.com/wd/callback',
        k1: 'secret-k1',
        defaultDescription: 'Voucher #1',
        minWithdrawableSats: 2,
        maxWithdrawableSats: 50,
        host: 'example.com',
      },
    })
  })

  it('classifies a payRequest and returns the endpoint URL', async () => {
    mockFetchOnce({
      tag: 'payRequest',
      callback: 'https://example.com/pay/cb',
      minSendable: 1000,
      maxSendable: 100000,
    })

    const resolved = await resolveLnurl(
      'https://example.com/lnurl/pay?tag=payRequest',
    )
    expect(resolved).toEqual({
      kind: 'pay',
      lnurlpUrl: 'https://example.com/lnurl/pay?tag=payRequest',
    })
  })

  it('returns null (no fetch) for a non-LNURL input', async () => {
    global.fetch = vi.fn() as unknown as typeof fetch
    expect(await resolveLnurl('lnbc1abc')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('throws on an ERROR status response', async () => {
    mockFetchOnce({ status: 'ERROR', reason: 'gone' })
    await expect(resolveLnurl('lnurlw://example.com/wd')).rejects.toBeInstanceOf(
      LnurlError,
    )
  })

  it('throws on an unsupported tag', async () => {
    mockFetchOnce({ tag: 'channelRequest' })
    await expect(resolveLnurl('lnurlw://example.com/wd')).rejects.toThrow(
      /unsupported/i,
    )
  })

  it('throws when a withdraw voucher has no withdrawable amount', async () => {
    mockFetchOnce({
      tag: 'withdrawRequest',
      callback: 'https://example.com/cb',
      k1: 'k',
      maxWithdrawable: 0,
    })
    await expect(resolveLnurl('lnurlw://example.com/wd')).rejects.toBeInstanceOf(
      LnurlError,
    )
  })
})

describe('submitLnurlWithdraw', () => {
  it('posts k1 + pr to the callback and resolves on OK', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'OK' }),
    })) as unknown as typeof fetch
    global.fetch = fetchMock

    await submitLnurlWithdraw(
      'https://example.com/cb?voucher=1',
      'my-k1',
      'lnbc1invoice',
    )

    const calledUrl = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string
    const u = new URL(calledUrl)
    expect(u.searchParams.get('k1')).toBe('my-k1')
    expect(u.searchParams.get('pr')).toBe('lnbc1invoice')
    expect(u.searchParams.get('voucher')).toBe('1')
  })

  it('throws with the service reason on ERROR', async () => {
    mockFetchOnce({ status: 'ERROR', reason: 'already claimed' })
    await expect(
      submitLnurlWithdraw('https://example.com/cb', 'k', 'lnbc1'),
    ).rejects.toThrow(/already claimed/)
  })

  it('throws on a non-ok HTTP status', async () => {
    mockFetchOnce(null, false, 502)
    await expect(
      submitLnurlWithdraw('https://example.com/cb', 'k', 'lnbc1'),
    ).rejects.toBeInstanceOf(LnurlError)
  })
})
