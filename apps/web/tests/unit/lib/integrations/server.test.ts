// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const vault = vi.hoisted(() => ({
  secret: 'x'.repeat(40) as string | undefined
}))
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    nwcVault: { secret: vault.secret, enabled: !!vault.secret }
  }))
}))
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn() }))

import {
  isAvailable,
  publicIntegrationFlags,
  resolveIntegration,
  sealSecret
} from '@/lib/integrations/server'

beforeEach(() => {
  vault.secret = 'x'.repeat(40)
})

describe('integration secrets', () => {
  it('seals with the NWC vault and decrypts on read', () => {
    const sealed = sealSecret('wapu_api_key', 'my-key')
    expect(sealed).toMatch(/^lwrw1:/)
    expect(sealed).not.toContain('my-key')
    const cfg = resolveIntegration('wapu', {
      wapu_enabled: 'true',
      wapu_api_key: sealed
    })
    expect(cfg).toMatchObject({ enabled: true, configured: true })
    expect(cfg.values.wapu_api_key).toBe('my-key')
  })

  it('binds the ciphertext to its key (cannot be moved to another field)', () => {
    const sealed = sealSecret('wapu_api_key', 'my-key')
    expect(() =>
      resolveIntegration('bullbitcoin', { bullbitcoin_api_key: sealed })
    ).toThrow()
  })

  it('stores plaintext when no vault secret is set', () => {
    vault.secret = undefined
    expect(sealSecret('wapu_api_key', 'plain')).toBe('plain')
    expect(
      resolveIntegration('wapu', { wapu_api_key: 'plain' }).values.wapu_api_key
    ).toBe('plain')
  })
})

describe('availability', () => {
  it('needs enabled AND configured', () => {
    expect(isAvailable('wapu', { wapu_enabled: 'true' })).toBe(false)
    expect(isAvailable('wapu', { wapu_api_key: 'k' })).toBe(false)
    expect(
      isAvailable('wapu', { wapu_enabled: 'true', wapu_api_key: 'k' })
    ).toBe(true)
  })

  it('counts field defaults as configured (alias URL)', () => {
    expect(isAvailable('alias', { alias_enabled: 'true' })).toBe(true)
    expect(resolveIntegration('alias', {}).values.alias_api_url).toBe(
      'https://api.masize.com'
    )
  })

  it('exposes only usable integrations as public flags', () => {
    expect(
      publicIntegrationFlags({
        wapu_enabled: 'true',
        wapu_api_key: 'k',
        bullbitcoin_enabled: 'true'
      })
    ).toEqual({ integration_wapu: 'true' })
  })
})
