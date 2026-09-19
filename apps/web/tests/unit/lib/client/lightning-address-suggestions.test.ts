import { describe, expect, it } from 'vitest'
import {
  buildLightningAddressSuggestions,
  getDomainAvatarUrl,
  lightningAddressMatchesQuery,
  resolveCurrentLightningDomain
} from '@/lib/client/lightning-address-suggestions'

describe('lightning-address-suggestions', () => {
  it('builds ten suggestions with the current domain first', () => {
    const suggestions = buildLightningAddressSuggestions('hola', 'lawallet.io')

    expect(suggestions).toHaveLength(10)
    expect(suggestions[0]).toMatchObject({
      lightningAddress: 'hola@lawallet.io',
      domain: 'lawallet.io'
    })
    expect(suggestions.map(s => s.lightningAddress)).toContain(
      'hola@lacrypta.ar'
    )
    expect(suggestions.map(s => s.lightningAddress)).toContain(
      'hola@walletofsatoshi.com'
    )
    expect(suggestions.map(s => s.lightningAddress)).toContain('hola@blink.sv')
    expect(suggestions.map(s => s.lightningAddress)).toContain('hola@strike.me')
  })

  it('filters domains while typing after @', () => {
    const suggestions = buildLightningAddressSuggestions(
      'hola@b',
      'lawallet.io'
    )

    expect(suggestions.map(s => s.lightningAddress)).toEqual([
      'hola@blink.sv',
      'hola@bitrefill.me'
    ])
  })

  it('keeps the current-domain completion even when that address is saved', () => {
    const suggestions = buildLightningAddressSuggestions('hola', 'lawallet.io')

    expect(suggestions.map(s => s.lightningAddress)).toContain(
      'hola@lawallet.io'
    )
    expect(suggestions.map(s => s.lightningAddress)).toContain('hola@blink.sv')
  })

  it('matches a stored recipient by local-part prefix, case-insensitively', () => {
    expect(
      lightningAddressMatchesQuery('fierillo@lawallet.io', 'fierillo')
    ).toBe(true)
    expect(lightningAddressMatchesQuery('fierillo@lawallet.io', 'FIER')).toBe(
      true
    )
    expect(
      lightningAddressMatchesQuery('fierillo@lawallet.io', 'fierillo@law')
    ).toBe(true)
    expect(lightningAddressMatchesQuery('fierillo@lawallet.io', 'satoshi')).toBe(
      false
    )
    expect(
      lightningAddressMatchesQuery('fierillo@lawallet.io', 'lawallet')
    ).toBe(false)
  })

  it('uses lawallet.io when the current address is local dev', () => {
    expect(resolveCurrentLightningDomain('alice@localhost:3885')).toBe(
      'lawallet.io'
    )
  })

  it('resolves avatar URLs from the static domain image folder', () => {
    expect(getDomainAvatarUrl('blink.sv')).toBe(
      'https://raw.githubusercontent.com/lawalletio/static/main/public/img/domains/blink.sv.png'
    )
  })
})
