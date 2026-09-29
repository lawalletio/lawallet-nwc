import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestLnurlInvoice } from '@/lib/client/lnurl-invoice'
import { stubFetch } from '@/tests/helpers/stub-fetch'

const LNURLP_URL = 'https://example.com/.well-known/lnurlp/satoshi'
const CALLBACK = 'https://example.com/lnurl/cb'

afterEach(() => {
  vi.unstubAllGlobals()
})

function metadata(commentAllowed?: number) {
  return {
    tag: 'payRequest',
    callback: CALLBACK,
    minSendable: 1000,
    maxSendable: 100_000_000,
    ...(commentAllowed === undefined ? {} : { commentAllowed })
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('requestLnurlInvoice', () => {
  it('sends a comment truncated to the advertised budget', async () => {
    const fetchMock = stubFetch(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === LNURLP_URL) return jsonResponse(metadata(5))
      return jsonResponse({ pr: 'lnbc1comment' })
    })

    const invoice = await requestLnurlInvoice(LNURLP_URL, 21, 'hello world')

    expect(invoice).toEqual({
      paymentRequest: 'lnbc1comment',
      comment: 'hello'
    })
    const callback = new URL(String(fetchMock.mock.calls[1]?.[0]))
    expect(callback.searchParams.get('amount')).toBe('21000')
    expect(callback.searchParams.get('comment')).toBe('hello')
  })

  it('omits the comment when the recipient does not advertise one', async () => {
    const fetchMock = stubFetch(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === LNURLP_URL) return jsonResponse(metadata())
      return jsonResponse({ pr: 'lnbc1plain' })
    })

    const invoice = await requestLnurlInvoice(LNURLP_URL, 21, 'thanks')

    expect(invoice.comment).toBeNull()
    const callback = new URL(String(fetchMock.mock.calls[1]?.[0]))
    expect(callback.searchParams.has('comment')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('omits the comment when commentAllowed is 0', async () => {
    const fetchMock = stubFetch(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === LNURLP_URL) return jsonResponse(metadata(0))
      return jsonResponse({ pr: 'lnbc1plain' })
    })

    const invoice = await requestLnurlInvoice(LNURLP_URL, 21, 'thanks')

    expect(invoice.comment).toBeNull()
    const callback = new URL(String(fetchMock.mock.calls[1]?.[0]))
    expect(callback.searchParams.has('comment')).toBe(false)
  })

  it('retries without the comment when the recipient rejects it', async () => {
    const fetchMock = stubFetch(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.href === LNURLP_URL) return jsonResponse(metadata(200))
      if (url.searchParams.has('comment')) {
        return jsonResponse(
          { status: 'ERROR', reason: 'comments are disabled' },
          400
        )
      }
      return jsonResponse({ pr: 'lnbc1nocomment' })
    })

    const invoice = await requestLnurlInvoice(LNURLP_URL, 21, 'thanks')

    expect(invoice).toEqual({
      paymentRequest: 'lnbc1nocomment',
      comment: null
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const retried = new URL(String(fetchMock.mock.calls[2]?.[0]))
    expect(retried.searchParams.has('comment')).toBe(false)
    expect(retried.searchParams.get('amount')).toBe('21000')
  })

  it('does not retry a callback failure that had no comment', async () => {
    stubFetch(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === LNURLP_URL) return jsonResponse(metadata(0))
      return jsonResponse({ status: 'ERROR', reason: 'amount too small' }, 400)
    })

    await expect(requestLnurlInvoice(LNURLP_URL, 21, 'thanks')).rejects.toThrow(
      'Recipient callback returned 400'
    )
  })
})
