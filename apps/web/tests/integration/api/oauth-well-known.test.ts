import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/settings', () => ({ getSettings: vi.fn() }))

import '@/tests/helpers/prisma-mock'
import {
  GET as authorizationServer,
  OPTIONS as authorizationServerOptions
} from '@/app/.well-known/oauth-authorization-server/route'
import {
  GET as protectedResource,
  OPTIONS as protectedResourceOptions
} from '@/app/.well-known/oauth-protected-resource/[[...resource]]/route'
import { getSettings } from '@/lib/settings'

const AS_DOCUMENT = {
  issuer: 'https://example.org',
  authorization_endpoint: 'https://example.org/oauth/authorize',
  token_endpoint: 'https://example.org/api/oauth/token',
  registration_endpoint: 'https://example.org/api/oauth/register',
  revocation_endpoint: 'https://example.org/api/oauth/revoke',
  scopes_supported: ['read', 'write', 'spend'],
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: ['none'],
  revocation_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'],
  authorization_response_iss_parameter_supported: true
}

const PR_DOCUMENT = {
  resource: 'https://example.org/api/mcp',
  authorization_servers: ['https://example.org'],
  scopes_supported: ['read', 'write', 'spend'],
  bearer_methods_supported: ['header']
}

function expectPublicCachedJson(res: Response) {
  expect(res.status).toBe(200)
  expect(res.headers.get('access-control-allow-origin')).toBe('*')
  expect(res.headers.get('cache-control')).toBe('public, max-age=300')
}

const prm = (path: string, resource?: string[]) =>
  protectedResource(
    createNextRequest(path) as never,
    createParamsPromise({ resource })
  )

beforeEach(() => {
  vi.mocked(getSettings).mockResolvedValue({ endpoint: 'https://example.org' })
})

describe('GET /.well-known/oauth-authorization-server', () => {
  it('serves RFC 8414 metadata matching the routes', async () => {
    const res = await authorizationServer(
      createNextRequest('/.well-known/oauth-authorization-server') as never
    )
    expectPublicCachedJson(res)
    expect(await res.json()).toEqual(AS_DOCUMENT)
  })

  it('answers CORS preflight', async () => {
    const res = authorizationServerOptions()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('GET /.well-known/oauth-protected-resource[/api/mcp]', () => {
  it('serves the same RFC 9728 document at the path-suffixed and root URLs', async () => {
    for (const res of [
      await prm('/.well-known/oauth-protected-resource/api/mcp', [
        'api',
        'mcp'
      ]),
      await prm('/.well-known/oauth-protected-resource')
    ]) {
      expectPublicCachedJson(res)
      expect(await res.json()).toEqual(PR_DOCUMENT)
    }
  })

  it('names the authorization server by its exact issuer', async () => {
    const [as, pr] = await Promise.all([
      authorizationServer(
        createNextRequest('/.well-known/oauth-authorization-server') as never
      ).then(r => r.json()),
      prm('/.well-known/oauth-protected-resource/api/mcp', ['api', 'mcp']).then(
        r => r.json()
      )
    ])
    expect(pr.authorization_servers[0]).toBe(as.issuer)
  })

  it.each([[['api', 'mcp', 'public']], [['api']], [['other']]])(
    'answers 404 for the suffix %j, still with CORS',
    async resource => {
      const res = await prm(
        `/.well-known/oauth-protected-resource/${resource.join('/')}`,
        resource
      )
      expect(res.status).toBe(404)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    }
  )

  it('answers CORS preflight', () => {
    expect(protectedResourceOptions().status).toBe(204)
  })
})
