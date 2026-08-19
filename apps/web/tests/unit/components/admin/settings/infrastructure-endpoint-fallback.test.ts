import { describe, expect, it } from 'vitest'
import { resolveEndpointValue } from '@/components/admin/settings/infrastructure-tab'

// The endpoint field must never render blank — see resolveEndpointValue.
describe('resolveEndpointValue', () => {
  it('keeps a stored endpoint verbatim', () => {
    expect(resolveEndpointValue('https://app.example.com', 'example.com')).toBe(
      'https://app.example.com'
    )
  })

  it('falls back to the configured domain when the endpoint is unset', () => {
    expect(resolveEndpointValue('', 'Example.com')).toBe('https://example.com')
  })

  it('treats a whitespace-only endpoint as unset', () => {
    expect(resolveEndpointValue('   ', 'example.com')).toBe(
      'https://example.com'
    )
  })

  it('falls back to the current origin when no domain is configured', () => {
    expect(resolveEndpointValue('', '')).toBe(window.location.origin)
    expect(resolveEndpointValue()).toBe(window.location.origin)
  })
})
