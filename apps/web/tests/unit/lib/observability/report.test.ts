import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ getCurrentReqId: () => 'req-test' }))

const { captureException } = vi.hoisted(() => ({
  captureException: vi.fn()
}))
vi.mock('@sentry/nextjs', () => ({ captureException }))

import { reportError } from '@/lib/observability/report'

const ORIGINAL_DSN = process.env.SENTRY_DSN

afterEach(() => {
  process.env.SENTRY_DSN = ORIGINAL_DSN
  captureException.mockReset()
})

// The capture runs after a dynamic import resolves.
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('reportError', () => {
  it('captures with the area tag when a DSN is configured', async () => {
    process.env.SENTRY_DSN = 'https://key@example.ingest.sentry.io/1'
    const err = new Error('ledger write failed')

    reportError(err, 'mcp-pay')
    await flush()

    expect(captureException).toHaveBeenCalledWith(err, {
      level: 'error',
      tags: { area: 'mcp-pay', reqId: 'req-test' }
    })
  })

  it('wraps a log key in an Error and honours the level', async () => {
    process.env.SENTRY_DSN = 'https://key@example.ingest.sentry.io/1'

    reportError('card.payment_outcome_unknown', 'card-pay', 'warning')
    await flush()

    const [error, context] = captureException.mock.calls[0]
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('card.payment_outcome_unknown')
    expect(context.level).toBe('warning')
  })

  it('is a no-op without a DSN', async () => {
    delete process.env.SENTRY_DSN

    reportError(new Error('x'), 'voucher')
    await flush()

    expect(captureException).not.toHaveBeenCalled()
  })
})
