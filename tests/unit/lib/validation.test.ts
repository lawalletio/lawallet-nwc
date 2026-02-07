import { describe, it, expect } from 'vitest'
import {
  idParam,
  userIdParam,
  createCardSchema,
  scanCardQuerySchema,
  otcParam,
  lud16UsernameParam,
  lud16CallbackQuerySchema,
  updateLightningAddressSchema,
  updateNwcSchema,
  updateRoleSchema,
  settingsBodySchema,
  externalDeviceKeyParam,
  createRemoteCardSchema,
  jwtRequestSchema,
  waitlistSchema,
} from '@/lib/validation/schemas'

describe('Validation Schemas', () => {
  describe('idParam', () => {
    it('accepts valid id', () => {
      expect(idParam.parse({ id: 'abc123' })).toEqual({ id: 'abc123' })
    })

    it('rejects empty id', () => {
      expect(() => idParam.parse({ id: '' })).toThrow()
    })

    it('rejects missing id', () => {
      expect(() => idParam.parse({})).toThrow()
    })
  })

  describe('userIdParam', () => {
    it('accepts valid userId', () => {
      expect(userIdParam.parse({ userId: 'user_123' })).toEqual({ userId: 'user_123' })
    })

    it('rejects empty userId', () => {
      expect(() => userIdParam.parse({ userId: '' })).toThrow()
    })
  })

  describe('createCardSchema', () => {
    it('accepts valid card data', () => {
      const data = { id: 'card_1', designId: 'design_1' }
      expect(createCardSchema.parse(data)).toEqual(data)
    })

    it('rejects missing id', () => {
      expect(() => createCardSchema.parse({ designId: 'design_1' })).toThrow()
    })

    it('rejects missing designId', () => {
      expect(() => createCardSchema.parse({ id: 'card_1' })).toThrow()
    })
  })

  describe('scanCardQuerySchema', () => {
    it('accepts valid p and c', () => {
      const data = { p: 'param1', c: 'param2' }
      expect(scanCardQuerySchema.parse(data)).toEqual(data)
    })

    it('rejects missing p', () => {
      expect(() => scanCardQuerySchema.parse({ c: 'param2' })).toThrow()
    })

    it('rejects missing c', () => {
      expect(() => scanCardQuerySchema.parse({ p: 'param1' })).toThrow()
    })
  })

  describe('otcParam', () => {
    it('accepts valid otc', () => {
      expect(otcParam.parse({ otc: 'abc123' })).toEqual({ otc: 'abc123' })
    })

    it('rejects empty otc', () => {
      expect(() => otcParam.parse({ otc: '' })).toThrow()
    })
  })

  describe('lud16UsernameParam', () => {
    it('accepts valid username', () => {
      expect(lud16UsernameParam.parse({ username: 'alice' })).toEqual({ username: 'alice' })
    })

    it('rejects empty username', () => {
      expect(() => lud16UsernameParam.parse({ username: '' })).toThrow()
    })
  })

  describe('lud16CallbackQuerySchema', () => {
    it('accepts valid amount', () => {
      expect(lud16CallbackQuerySchema.parse({ amount: '1000' })).toEqual({ amount: '1000' })
    })

    it('rejects missing amount', () => {
      expect(() => lud16CallbackQuerySchema.parse({})).toThrow()
    })
  })

  describe('updateLightningAddressSchema', () => {
    it('accepts valid username', () => {
      expect(updateLightningAddressSchema.parse({ username: 'alice123' })).toEqual({
        username: 'alice123',
      })
    })

    it('rejects uppercase', () => {
      expect(() => updateLightningAddressSchema.parse({ username: 'Alice' })).toThrow()
    })

    it('rejects special characters', () => {
      expect(() => updateLightningAddressSchema.parse({ username: 'alice!' })).toThrow()
    })

    it('rejects too long (>16)', () => {
      expect(() =>
        updateLightningAddressSchema.parse({ username: 'a'.repeat(17) })
      ).toThrow()
    })

    it('accepts max length (16)', () => {
      const username = 'a'.repeat(16)
      expect(updateLightningAddressSchema.parse({ username })).toEqual({ username })
    })
  })

  describe('updateNwcSchema', () => {
    it('accepts valid NWC URI', () => {
      expect(updateNwcSchema.parse({ nwcUri: 'nostr+walletconnect://...' })).toEqual({
        nwcUri: 'nostr+walletconnect://...',
      })
    })

    it('rejects empty NWC URI', () => {
      expect(() => updateNwcSchema.parse({ nwcUri: '' })).toThrow()
    })
  })

  describe('updateRoleSchema', () => {
    it('accepts valid roles', () => {
      for (const role of ['ADMIN', 'OPERATOR', 'VIEWER', 'USER']) {
        expect(updateRoleSchema.parse({ role })).toEqual({ role })
      }
    })

    it('rejects invalid role', () => {
      expect(() => updateRoleSchema.parse({ role: 'SUPERADMIN' })).toThrow()
    })
  })

  describe('settingsBodySchema', () => {
    it('accepts valid settings', () => {
      const data = { endpoint: 'https://example.com', theme: 'dark' }
      expect(settingsBodySchema.parse(data)).toEqual(data)
    })

    it('rejects empty key name', () => {
      expect(() => settingsBodySchema.parse({ '': 'value' })).toThrow()
    })

    it('rejects key > 32 chars', () => {
      expect(() => settingsBodySchema.parse({ ['a'.repeat(33)]: 'value' })).toThrow()
    })

    it('rejects uppercase key', () => {
      expect(() => settingsBodySchema.parse({ 'MyKey': 'value' })).toThrow()
    })
  })

  describe('externalDeviceKeyParam', () => {
    it('accepts valid key', () => {
      expect(externalDeviceKeyParam.parse({ externalDeviceKey: 'key123' })).toEqual({
        externalDeviceKey: 'key123',
      })
    })

    it('rejects empty key', () => {
      expect(() => externalDeviceKeyParam.parse({ externalDeviceKey: '' })).toThrow()
    })
  })

  describe('createRemoteCardSchema', () => {
    it('accepts valid data', () => {
      const data = { designId: 'd1', cardUID: 'uid1' }
      expect(createRemoteCardSchema.parse(data)).toEqual(data)
    })

    it('rejects missing fields', () => {
      expect(() => createRemoteCardSchema.parse({ designId: 'd1' })).toThrow()
      expect(() => createRemoteCardSchema.parse({ cardUID: 'uid1' })).toThrow()
    })
  })

  describe('jwtRequestSchema', () => {
    it('accepts valid JWT request', () => {
      const data = { userId: 'user_1' }
      const result = jwtRequestSchema.parse(data)
      expect(result.userId).toBe('user_1')
      expect(result.expiresIn).toBe('1h') // default
    })

    it('accepts custom expiresIn', () => {
      const data = { userId: 'user_1', expiresIn: '24h' }
      expect(jwtRequestSchema.parse(data)).toEqual({
        userId: 'user_1',
        expiresIn: '24h',
      })
    })

    it('accepts additional claims', () => {
      const data = { userId: 'user_1', additionalClaims: { role: 'admin' } }
      expect(jwtRequestSchema.parse(data).additionalClaims).toEqual({ role: 'admin' })
    })
  })

  describe('waitlistSchema', () => {
    it('accepts valid email', () => {
      expect(waitlistSchema.parse({ email: 'alice@example.com' })).toEqual({
        email: 'alice@example.com',
      })
    })

    it('accepts email with name', () => {
      const data = { email: 'alice@example.com', name: 'Alice' }
      expect(waitlistSchema.parse(data)).toEqual(data)
    })

    it('rejects invalid email', () => {
      expect(() => waitlistSchema.parse({ email: 'not-email' })).toThrow()
    })
  })

})
