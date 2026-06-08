import { describe, expect, it } from 'vitest'
import {
  buildInstructionProfile,
  detectPlatform,
  normalizeDomainProbeInput,
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
})
