import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { lookupMock, httpsRequestMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  httpsRequestMock: vi.fn()
}))

vi.mock('node:dns/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:dns/promises')>()
  return {
    ...actual,
    lookup: lookupMock,
    default: { ...actual, lookup: lookupMock }
  }
})

vi.mock('node:https', async importOriginal => {
  const actual = await importOriginal<typeof import('node:https')>()
  return {
    ...actual,
    request: httpsRequestMock,
    default: { ...actual, request: httpsRequestMock }
  }
})

import { postNotificationWebhook } from '@/lib/remote-wallet-notifications/webhook'

const webhookInput = {
  url: 'https://slow-dns.example/webhook',
  requestId: 'a'.repeat(64),
  eventKey: 'event-key',
  body: '{}'
}

function mockHttpsResponse(status: number, body: string) {
  httpsRequestMock.mockImplementation(
    (_url: unknown, _opts: unknown, onResponse: (res: unknown) => void) => ({
      once() {
        return this
      },
      end() {
        const res = {
          statusCode: status,
          on(event: string, handler: (chunk: Buffer) => void) {
            if (event === 'data') handler(Buffer.from(body))
            return res
          },
          once(event: string, handler: () => void) {
            if (event === 'end') handler()
            return res
          }
        }
        onResponse(res)
      }
    })
  )
}

describe('postNotificationWebhook DNS lookup', () => {
  beforeEach(() => {
    lookupMock.mockReset()
    httpsRequestMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects when DNS lookup hangs past the application timeout', async () => {
    vi.useFakeTimers()
    lookupMock.mockReturnValue(new Promise(() => {}))

    const pending = postNotificationWebhook(webhookInput)
    const settled = vi.fn()
    void pending.then(settled, settled)

    await vi.advanceTimersByTimeAsync(6999)
    expect(settled).not.toHaveBeenCalled()

    const rejected = expect(pending).rejects.toThrow(
      'Webhook DNS lookup timed out'
    )
    await vi.advanceTimersByTimeAsync(1)
    await rejected
  })

  it('propagates transient getaddrinfo failures from lookup', async () => {
    lookupMock.mockRejectedValue(
      Object.assign(new Error('getaddrinfo EAI_AGAIN slow-dns.example'), {
        code: 'EAI_AGAIN'
      })
    )

    await expect(postNotificationWebhook(webhookInput)).rejects.toThrow(
      /getaddrinfo EAI_AGAIN/
    )
  })

  it('maps a successful public lookup onto the pinned HTTPS request', async () => {
    lookupMock.mockResolvedValue([{ address: '1.1.1.1', family: 4 }])
    mockHttpsResponse(204, 'ok')

    await expect(postNotificationWebhook(webhookInput)).resolves.toEqual({
      status: 204,
      body: 'ok'
    })
    expect(httpsRequestMock).toHaveBeenCalled()
  })

  it('rejects when DNS resolves to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])

    await expect(postNotificationWebhook(webhookInput)).rejects.toThrow(
      'Webhook URL resolves to a private network'
    )
    expect(httpsRequestMock).not.toHaveBeenCalled()
  })

  it('rejects when DNS returns no addresses', async () => {
    lookupMock.mockResolvedValue([])

    await expect(postNotificationWebhook(webhookInput)).rejects.toThrow(
      'Webhook URL resolves to a private network'
    )
  })
})
