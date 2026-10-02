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

  it('lets MCP clients send Mcp-* headers and read the OAuth challenge', () => {
    for (const path of ['/api/mcp', '/api/mcp/public']) {
      const preflight = proxy(req(path, 'OPTIONS'))
      expect(preflight.status).toBe(204)
      const allowed = preflight.headers.get('Access-Control-Allow-Headers')
      for (const header of [
        'Authorization',
        'Content-Type',
        'Mcp-Protocol-Version',
        'Mcp-Method',
        'Mcp-Name',
        'Mcp-Session-Id',
        'Last-Event-ID'
      ]) {
        expect(allowed).toContain(header)
      }
      const res = proxy(req(path, 'POST'))
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(res.headers.get('Access-Control-Expose-Headers')).toBe(
        'WWW-Authenticate'
      )
    }
    // Other routes keep the narrow header list.
    expect(
      proxy(req('/api/mcpx', 'OPTIONS')).headers.get(
        'Access-Control-Expose-Headers'
      )
    ).toBeNull()
  })

  it('still covers authenticated card admin routes', () => {
    const res = proxy(req('/api/cards', 'OPTIONS'))
    expect(res.status).toBe(204)
    expect(
      proxy(req('/api/cards/abc123')).headers.get('Access-Control-Allow-Origin')
    ).toBe('*')
  })
})
