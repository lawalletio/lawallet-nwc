import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))

import '@/tests/helpers/prisma-mock'
import {
  OAUTH_MAX_SPEND_LIMIT_SATS,
  isAllowedOAuthRedirectUri,
  oauthScopeSchema
} from '@/lib/validation/schemas'
import {
  MAX_SPEND_LIMIT_SATS,
  OAUTH_SCOPES,
  withImpliedScopes
} from '@/lib/oauth/constants'
import {
  buildRedirect,
  offeredScopes,
  redirectHost,
  redirectUriMatches,
  resourceMatches
} from '@/lib/oauth/authorize'

describe('shared OAuth schema constants', () => {
  it('stay in step with lib/oauth/constants', () => {
    expect(oauthScopeSchema.options).toEqual([...OAUTH_SCOPES])
    expect(OAUTH_MAX_SPEND_LIMIT_SATS).toBe(MAX_SPEND_LIMIT_SATS)
  })
})

describe('isAllowedOAuthRedirectUri', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://app.example.com:8443/cb?tenant=a',
    'http://localhost:6274/oauth/callback',
    'http://localhost/callback',
    'http://127.0.0.1:6276/oauth/callback',
    'http://[::1]:33418/',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'vscode://vscode.github-authentication/did-authenticate',
    'com.example.app:/oauth2redirect'
  ])('accepts %s', uri => {
    expect(isAllowedOAuthRedirectUri(uri)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'JavaScript://x/%0aalert(1)',
    'data:text/html,hi',
    'vbscript:msgbox',
    'file:///etc/passwd',
    'blob:https://example.org/uuid',
    'about:blank',
    'ws://localhost/cb',
    'wss://example.org/cb',
    'ftp://example.org/cb',
    'chrome://settings',
    'view-source:https://example.org',
    'intent://scan/#Intent;scheme=zxing;end'
  ])('rejects the forbidden scheme in %s', uri => {
    expect(isAllowedOAuthRedirectUri(uri)).toBe(false)
  })

  it.each([
    ['plain http off loopback', 'http://example.org/cb'],
    ['a loopback look-alike', 'http://localhost.evil.com/cb'],
    ['a fragment', 'https://example.org/cb#frag'],
    ['an empty fragment', 'https://example.org/cb#'],
    ['userinfo', 'https://claude.ai@evil.com/cb'],
    ['a password', 'https://:secret@example.org/cb'],
    ['whitespace', 'https://example.org/c b'],
    ['a newline the parser would drop', 'https://example.org/\ncb'],
    ['non-ASCII', 'https://exämple.org/cb'],
    ['a relative reference', '/callback'],
    ['garbage', 'not a url'],
    ['an empty string', '']
  ])('rejects %s', (_label, uri) => {
    expect(isAllowedOAuthRedirectUri(uri)).toBe(false)
  })
})

describe('redirectUriMatches', () => {
  it('matches identical strings', () => {
    expect(
      redirectUriMatches(
        'https://app.example.com/cb',
        'https://app.example.com/cb'
      )
    ).toBe(true)
  })

  it('matches a loopback URI on any port (RFC 8252 §7.3)', () => {
    expect(
      redirectUriMatches(
        'http://localhost:54321/callback',
        'http://localhost/callback'
      )
    ).toBe(true)
    expect(
      redirectUriMatches(
        'http://127.0.0.1:1234/oauth/callback',
        'http://127.0.0.1:6276/oauth/callback'
      )
    ).toBe(true)
    expect(
      redirectUriMatches('http://[::1]:9/cb?a=1', 'http://[::1]/cb?a=1')
    ).toBe(true)
  })

  it.each([
    [
      'another loopback host',
      'http://127.0.0.1:1234/callback',
      'http://localhost/callback'
    ],
    [
      'another path',
      'http://localhost:1234/other',
      'http://localhost/callback'
    ],
    [
      'another query',
      'http://localhost:1234/callback?x=1',
      'http://localhost/callback'
    ],
    [
      'a fragment',
      'http://localhost:1234/callback#x',
      'http://localhost/callback'
    ],
    [
      'userinfo',
      'http://u@localhost:1234/callback',
      'http://localhost/callback'
    ],
    [
      'a non-loopback port',
      'https://app.example.com:8443/cb',
      'https://app.example.com/cb'
    ],
    [
      'a non-loopback host',
      'https://evil.example.com/cb',
      'https://app.example.com/cb'
    ],
    [
      'https on loopback',
      'https://localhost:1234/callback',
      'https://localhost/callback'
    ],
    ['garbage', 'not a url', 'http://localhost/callback']
  ])('does not match %s', (_label, requested, registered) => {
    expect(redirectUriMatches(requested, registered)).toBe(false)
  })
})

describe('redirectHost', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', 'claude.ai'],
    ['http://localhost:6274/oauth/callback', 'localhost:6274'],
    [
      'cursor://anysphere.cursor-mcp/oauth/callback',
      'cursor://anysphere.cursor-mcp'
    ],
    ['com.example.app:/oauth2redirect', '']
  ])('%s → %s', (uri, host) => {
    expect(redirectHost(uri)).toBe(host)
  })
})

describe('buildRedirect', () => {
  it('keeps the query the redirect URI already has', () => {
    const url = new URL(
      buildRedirect('https://app.example.com/cb?tenant=a', {
        code: 'lwac_x',
        state: 's',
        iss: 'https://example.org'
      })
    )
    expect(url.origin + url.pathname).toBe('https://app.example.com/cb')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tenant: 'a',
      code: 'lwac_x',
      state: 's',
      iss: 'https://example.org'
    })
  })

  it('skips absent values and works for native app schemes', () => {
    expect(
      buildRedirect('cursor://anysphere.cursor-mcp/oauth/callback', {
        error: 'access_denied',
        state: undefined
      })
    ).toBe('cursor://anysphere.cursor-mcp/oauth/callback?error=access_denied')
  })
})

describe('resourceMatches', () => {
  const resource = 'https://example.org/api/mcp'

  it.each([
    'https://example.org/api/mcp',
    'https://example.org/api/mcp/',
    'https://EXAMPLE.org/api/mcp',
    'HTTPS://example.org:443/api/mcp',
    'https://example.org',
    'https://example.org/'
  ])('accepts %s', value => {
    expect(resourceMatches(value, resource)).toBe(true)
  })

  it.each([
    'https://evil.example/api/mcp',
    'http://example.org/api/mcp',
    'https://example.org/api/mcp/public',
    'https://example.org/API/MCP',
    'https://example.org/api',
    'https://example.org/api/mcp?x=1',
    'https://example.org/api/mcp#x',
    'https://user@example.org/api/mcp',
    'https://example.org:8443/api/mcp',
    'not a url'
  ])('rejects %s', value => {
    expect(resourceMatches(value, resource)).toBe(false)
  })
})

describe('scopes', () => {
  it('adds read to write and spend, never write to spend', () => {
    expect(withImpliedScopes(['write'])).toEqual(['read', 'write'])
    expect(withImpliedScopes(['spend'])).toEqual(['read', 'spend'])
    expect(withImpliedScopes(['spend', 'read', 'spend'])).toEqual([
      'read',
      'spend'
    ])
    expect(withImpliedScopes(['read'])).toEqual(['read'])
  })

  it('offers the requested scopes we know, else all of them', () => {
    expect(offeredScopes('read')).toEqual(['read'])
    expect(offeredScopes('write  offline_access')).toEqual(['read', 'write'])
    expect(offeredScopes('spend')).toEqual(['read', 'spend'])
    expect(offeredScopes('openid profile')).toEqual(['read', 'write', 'spend'])
    expect(offeredScopes(undefined)).toEqual(['read', 'write', 'spend'])
  })
})
