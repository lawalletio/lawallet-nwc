import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Logger reads config at module load — stub both before importing the SUT.
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => {
  const stub = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
  return {
    logger: stub,
    createLogger: vi.fn(() => stub),
    withRequestLogging: (fn: unknown) => fn,
    getCurrentReqId: vi.fn(() => 'req-test')
  }
})

// error-handler pulls in maintenance → settings → prisma; stub the DB edge.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

// Activity log is fire-and-forget; stub so we don't pull in the event bus.
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    SERVER_DATABASE_ERROR: 'server.database_error',
    SERVER_UNHANDLED_ERROR: 'server.unhandled_error',
    USER_ERROR: 'user.error',
    ADDRESS_ERROR: 'address.error',
    CARD_ERROR: 'card.error',
    NWC_CONNECTION_ERROR: 'nwc.connection_error',
    INVOICE_GENERATION_FAILED: 'invoice.generation_failed'
  },
  logActivity: { fireAndForget: vi.fn() }
}))

const { captureException } = vi.hoisted(() => ({
  captureException: vi.fn()
}))
vi.mock('@sentry/nextjs', () => ({ captureException }))

import { handleApiError } from '@/types/server/error-handler'
import {
  AuthenticationError,
  InternalServerError,
  NotFoundError,
  ServiceUnavailableError
} from '@/types/server/errors'

const ORIGINAL_DSN = process.env.SENTRY_DSN

// The Sentry forward is fire-and-forget via dynamic import — settle it
// before asserting.
const flushSentryImport = () => vi.dynamicImportSettled()

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SENTRY_DSN = 'https://key@sentry.example.com/1'
})

afterEach(() => {
  if (ORIGINAL_DSN === undefined) delete process.env.SENTRY_DSN
  else process.env.SENTRY_DSN = ORIGINAL_DSN
})

describe('handleApiError Sentry forwarding', () => {
  it('captures 500s when SENTRY_DSN is set', async () => {
    const request = new Request('http://localhost:3000/api/cards/123')
    const error = new InternalServerError('db exploded')

    const response = handleApiError(error, undefined, request)
    await flushSentryImport()

    expect(response.status).toBe(500)
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException).toHaveBeenCalledWith(error, {
      tags: {
        reqId: 'req-test',
        code: error.code,
        path: '/api/cards/123'
      }
    })
  })

  it('captures the original cause for better grouping', async () => {
    const cause = new Error('boom')

    handleApiError(cause)
    await flushSentryImport()

    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException.mock.calls[0][0]).toBe(cause)
  })

  it('skips maintenance 503s (ServiceUnavailableError)', async () => {
    const response = handleApiError(new ServiceUnavailableError())
    await flushSentryImport()

    expect(response.status).toBe(503)
    expect(captureException).not.toHaveBeenCalled()
  })

  it('skips 4xx client errors', async () => {
    handleApiError(new NotFoundError())
    handleApiError(new AuthenticationError())
    await flushSentryImport()

    expect(captureException).not.toHaveBeenCalled()
  })

  it('skips capture when SENTRY_DSN is unset', async () => {
    delete process.env.SENTRY_DSN

    const response = handleApiError(new InternalServerError('db exploded'))
    await flushSentryImport()

    expect(response.status).toBe(500)
    expect(captureException).not.toHaveBeenCalled()
  })

  it('returns the error response unchanged when captureException throws', async () => {
    captureException.mockImplementation(() => {
      throw new Error('sentry down')
    })

    const response = handleApiError(new InternalServerError('db exploded'))
    await flushSentryImport()

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.error.message).toBe('db exploded')
  })
})
