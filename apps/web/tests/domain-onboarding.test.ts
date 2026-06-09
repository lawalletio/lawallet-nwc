import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildInstructionProfile,
  detectPlatform,
  normalizeDomainProbeInput,
  probeDomainRouting,
  type RootSample,
} from '@/lib/domain-onboarding'

function sample(body: string, headers: Record<string, string> = {}): RootSample {
  return {
    url: 'https://example.com',
    status: 200,
    headers,
    body,
  }
}

describe('domain onboarding helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes domain and endpoint values', () => {
    expect(
      normalizeDomainProbeInput({
        domain: ' HTTPS://Example.COM/path ',
        endpoint: 'APP.Example.com/',
      }),
    ).toEqual({
      domain: 'example.com',
      endpoint: 'https://app.example.com',
    })
  })

  it('defaults endpoint to the root domain', () => {
    expect(normalizeDomainProbeInput({ domain: 'example.com' })).toEqual({
      domain: 'example.com',
      endpoint: 'https://example.com',
    })
  })

  it('detects WordPress', () => {
    const platform = detectPlatform(sample('<link href="/wp-content/theme.css">'))
    expect(platform.kind).toBe('wordpress')
    expect(platform.confidence).toBe('high')
  })

  it('detects Next.js and Vercel', () => {
    expect(detectPlatform(sample('<script id="__NEXT_DATA__"></script>')).kind).toBe('nextjs')
    expect(detectPlatform(sample('', { 'x-vercel-id': 'gru1::abc' })).kind).toBe('vercel')
  })

  it('returns tailored rewrite instructions', () => {
    const wordpress = buildInstructionProfile(
      { kind: 'wordpress', label: 'WordPress', confidence: 'high', evidence: [] },
      'example.com',
      'https://lawallet.example.com',
    )
    expect(wordpress.snippet).toContain('RewriteRule')
    expect(wordpress.tip).toContain('lawallet.example.com')

    const nextjs = buildInstructionProfile(
      { kind: 'nextjs', label: 'Next.js', confidence: 'high', evidence: [] },
      'example.com',
      'https://lawallet.example.com',
    )
    expect(nextjs.snippet).toContain('async rewrites')
  })

  it('uses the API gateway as rewrite target when root domain is not LaWallet', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const href = String(url)
      if (href === 'https://example.com') {
        return new Response('<link href="/wp-content/theme.css">', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      if (href.includes('/.well-known/lnurlp/')) {
        return Response.json({ callback: 'https://gateway.example.com/api/lnurl/callback' })
      }
      if (href.includes('/.well-known/nostr.json')) {
        return Response.json({ names: {} })
      }
      return new Response('', { status: 404 })
    })

    const result = await probeDomainRouting({
      domain: 'example.com',
      endpoint: 'https://example.com',
      apiGatewayEndpoint: 'https://gateway.example.com',
      lnurlUsername: 'satoshi',
    })

    expect(result.endpoint).toBe('https://gateway.example.com')
    expect(result.status).toBe('ready')
    expect(result.instructions.snippet).toContain('https://gateway.example.com/.well-known/')
  })
})
