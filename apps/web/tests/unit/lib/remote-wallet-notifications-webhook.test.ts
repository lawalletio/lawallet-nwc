import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn()
}))

vi.mock('node:dns/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:dns/promises')>()
  return {
    ...actual,
    lookup: lookupMock,
    default: { ...actual, lookup: lookupMock }
  }
})

import { postNotificationWebhook } from '@/lib/remote-wallet-notifications/webhook'

const webhookInput = {
  url: 'https://slow-dns.example/webhook',
  requestId: 'a'.repeat(64),
  eventKey: 'event-key',
  body: '{}'
}

describe('postNotificationWebhook DNS lookup', () => {
  beforeEach(() => {
    lookupMock.mockReset()
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
})
