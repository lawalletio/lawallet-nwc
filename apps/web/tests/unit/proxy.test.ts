import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

const req = (path: string, method = 'GET') =>
  new NextRequest(`http://localhost:3000${path}`, { method })

describe('CORS proxy', () => {
  it('answers OPTIONS preflight with 204 and CORS headers', () => {
    const res = proxy(req('/api/settings', 'OPTIONS'))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PATCH')
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe(
      'Authorization, Content-Type'
    )
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400')
  })

  it('adds CORS headers to pass-through API responses', () => {
    const res = proxy(req('/api/wallet/addresses'))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('never exposes /api/jwt cross-origin', () => {
    for (const method of ['OPTIONS', 'POST', 'GET']) {
      const res = proxy(req('/api/jwt', method))
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    }
    const nested = proxy(req('/api/jwt/protected', 'OPTIONS'))
    expect(nested.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('leaves self-managed public CORS routes untouched', () => {
    for (const path of [
      '/api/lud16/alice',
      '/api/lud16/alice/cb',
      '/api/cards/abc123/scan',
      '/api/cards/abc123/scan/cb',
      '/api/cards/abc123/write',
      '/api/cards/abc123/wipe'
    ]) {
      const res = proxy(req(path, 'OPTIONS'))
      // Pass-through, not a 204: the route's own OPTIONS handler must run.
      expect(res.status).not.toBe(204)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    }
  })

  it('still covers authenticated card admin routes', () => {
    const res = proxy(req('/api/cards', 'OPTIONS'))
    expect(res.status).toBe(204)
    expect(
      proxy(req('/api/cards/abc123')).headers.get('Access-Control-Allow-Origin')
    ).toBe('*')
  })
})
