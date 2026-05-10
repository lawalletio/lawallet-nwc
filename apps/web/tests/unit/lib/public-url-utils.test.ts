import { describe, expect, it } from 'vitest'
import { buildPublicHost, buildPublicUrl, parseEndpoint } from '@/lib/public-url-utils'

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

describe('parseEndpoint', () => {
  it('returns null for empty or nullish input', () => {
    expect(parseEndpoint('')).toBeNull()
    expect(parseEndpoint('   ')).toBeNull()
    expect(parseEndpoint(undefined)).toBeNull()
    expect(parseEndpoint(null)).toBeNull()
  })

  it('preserves https scheme when present', () => {
    expect(parseEndpoint('https://app.example.com')).toEqual({
      protocol: 'https:',
      host: 'app.example.com',
    })
  })

  it('preserves http scheme when present', () => {
    expect(parseEndpoint('http://app.example.com')).toEqual({
      protocol: 'http:',
      host: 'app.example.com',
    })
  })

  it('preserves http scheme for localhost with port', () => {
    expect(parseEndpoint('http://localhost:3000')).toEqual({
      protocol: 'http:',
      host: 'localhost:3000',
    })
  })

  it('falls back to https when no scheme is provided', () => {
    expect(parseEndpoint('app.example.com')).toEqual({
      protocol: 'https:',
      host: 'app.example.com',
    })
  })

  it('falls back to http for bare localhost variants', () => {
    expect(parseEndpoint('localhost:3000')).toEqual({
      protocol: 'http:',
      host: 'localhost:3000',
    })
    expect(parseEndpoint('app.localhost:3000')).toEqual({
      protocol: 'http:',
      host: 'app.localhost:3000',
    })
    expect(parseEndpoint('127.0.0.1:8080')).toEqual({
      protocol: 'http:',
      host: '127.0.0.1:8080',
    })
  })

  it('trims whitespace, lowercases, and strips trailing slashes', () => {
    expect(parseEndpoint('  HTTPS://App.Example.Com/  ')).toEqual({
      protocol: 'https:',
      host: 'app.example.com',
    })
    expect(parseEndpoint('https://example.com///')).toEqual({
      protocol: 'https:',
      host: 'example.com',
    })
  })
})
