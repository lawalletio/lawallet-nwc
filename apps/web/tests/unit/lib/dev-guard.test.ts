import { describe, it, expect, vi, afterEach } from 'vitest'
import { assertDevRoutesEnabled } from '@/lib/dev-guard'
import { NotFoundError } from '@/types/server/errors'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('assertDevRoutesEnabled', () => {
  it('passes in development with ENABLE_DEV_ROUTES=true', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENABLE_DEV_ROUTES', 'true')

    expect(() => assertDevRoutesEnabled()).not.toThrow()
  })

  it('throws 404 in production even with the opt-in set', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_DEV_ROUTES', 'true')

    expect(() => assertDevRoutesEnabled()).toThrow(NotFoundError)
  })

  it('throws 404 in development without the opt-in', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENABLE_DEV_ROUTES', '')

    expect(() => assertDevRoutesEnabled()).toThrow(NotFoundError)
  })

  it('throws 404 in test without the opt-in', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ENABLE_DEV_ROUTES', '')

    expect(() => assertDevRoutesEnabled()).toThrow(NotFoundError)
  })

  it('requires the exact string "true"', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENABLE_DEV_ROUTES', '1')

    expect(() => assertDevRoutesEnabled()).toThrow(NotFoundError)
  })

  it('passes outside production with the opt-in (e.g. NODE_ENV=test)', () => {
    // Contract: hard-closed in production, explicit opt-in everywhere else.
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('ENABLE_DEV_ROUTES', 'true')

    expect(() => assertDevRoutesEnabled()).not.toThrow()
  })
})
