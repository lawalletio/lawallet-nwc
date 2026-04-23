import { describe, expect, it } from 'vitest'
import { buildPublicHost, buildPublicUrl } from '@/lib/public-url-utils'

describe('buildPublicHost', () => {
  it('combines domain and subdomain into a full host', () => {
    expect(buildPublicHost(' Example.com ', ' App ')).toBe('app.example.com')
  })

  it('returns the root domain when there is no subdomain', () => {
    expect(buildPublicHost('example.com')).toBe('example.com')
  })
})

describe('buildPublicUrl', () => {
  it('uses https for public hosts', () => {
    expect(buildPublicUrl('app.example.com')).toBe('https://app.example.com')
  })

  it('uses http for localhost-style hosts', () => {
    expect(buildPublicUrl('app.localhost:3000')).toBe('http://app.localhost:3000')
  })
})
