import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock config before importing logger (logger calls getConfig at module level)
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    isProduction: false,
    logPretty: false,
  })),
}))

import {
  getOrCreateRequestId,
  createLogger,
  logError,
  withRequestLogging,
  logger,
} from '@/lib/logger'

beforeEach(() => {
  vi.clearAllMocks()
  // Silence pino output during tests (pino writes to stdout/stderr directly)
  logger.level = 'silent'
})

describe('getOrCreateRequestId', () => {
  it('returns x-request-id from headers', () => {
    const headers = new Headers({ 'x-request-id': 'req-123' })
    expect(getOrCreateRequestId(headers)).toBe('req-123')
  })

  it('returns x-correlation-id when x-request-id is missing', () => {
    const headers = new Headers({ 'x-correlation-id': 'corr-456' })
    expect(getOrCreateRequestId(headers)).toBe('corr-456')
  })

  it('returns x-amzn-trace-id as fallback', () => {
    const headers = new Headers({ 'x-amzn-trace-id': 'trace-789' })
    expect(getOrCreateRequestId(headers)).toBe('trace-789')
  })

  it('generates UUID when no header is present', () => {
    const id = getOrCreateRequestId(new Headers())
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('generates UUID when headers is undefined', () => {
    const id = getOrCreateRequestId(undefined)
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('rejects header values longer than 200 characters', () => {
    const longId = 'x'.repeat(201)
    const headers = new Headers({ 'x-request-id': longId })
    const id = getOrCreateRequestId(headers)
    // Should generate a UUID instead of using the long value
    expect(id).not.toBe(longId)
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('trims whitespace from header values', () => {
    const headers = new Headers({ 'x-request-id': '  req-trimmed  ' })
    expect(getOrCreateRequestId(headers)).toBe('req-trimmed')
  })
})

describe('createLogger', () => {
  it('returns a logger without context', () => {
    const log = createLogger()
    expect(log).toBeDefined()
    expect(typeof log.info).toBe('function')
    expect(typeof log.error).toBe('function')
  })

  it('returns a child logger with context', () => {
    const log = createLogger({ module: 'test' })
    expect(log).toBeDefined()
    expect(typeof log.info).toBe('function')
  })
})

describe('logError', () => {
  it('does not throw when called with an Error', () => {
    expect(() => logError(new Error('test error'))).not.toThrow()
  })

  it('does not throw when called with string', () => {
    expect(() => logError('string error')).not.toThrow()
  })

  it('accepts optional context', () => {
    expect(() => logError(new Error('oops'), { source: 'test' })).not.toThrow()
  })
})

describe('withRequestLogging', () => {
  it('wraps a handler and returns a response', async () => {
    const handler = vi.fn(async (_req: Request) => new Response('ok', { status: 200 }))
    const wrapped = withRequestLogging(handler)

    const request = new Request('http://localhost:3000/api/test')
    const response = await wrapped(request)
    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalled()
  })

  it('sets x-request-id header on response', async () => {
    const handler = vi.fn(async (_req: Request) => new Response('ok', { status: 200 }))
    const wrapped = withRequestLogging(handler)

    const request = new Request('http://localhost:3000/api/test', {
      headers: { 'x-request-id': 'my-req-id' },
    })
    const response = await wrapped(request)
    expect(response.headers.get('x-request-id')).toBe('my-req-id')
  })

  it('rethrows errors from the handler', async () => {
    const handler = vi.fn(async (_req: Request): Promise<Response> => {
      throw new Error('handler blew up')
    })
    const wrapped = withRequestLogging(handler)

    const request = new Request('http://localhost:3000/api/test')
    await expect(wrapped(request)).rejects.toThrow('handler blew up')
  })
})
