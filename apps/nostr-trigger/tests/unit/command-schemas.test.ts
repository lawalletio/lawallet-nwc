import { describe, it, expect } from 'vitest'
import {
  createNwcSchema,
  addAdminSchema,
  nostrCommandSchema
} from '../../src/commands/types.js'

describe('command schemas', () => {
  it('accepts a valid create_nwc input', () => {
    const r = createNwcSchema.safeParse({
      label: 'test',
      nwcUri: 'nostr+walletconnect://abc?relay=wss://x&secret=y',
      enabled: true
    })
    expect(r.success).toBe(true)
  })

  it('rejects a blank label', () => {
    const r = createNwcSchema.safeParse({ label: '', nwcUri: 'x' })
    expect(r.success).toBe(false)
  })

  it('accepts a valid pubkey on add_admin', () => {
    const r = addAdminSchema.safeParse({
      pubkey: 'a'.repeat(64),
      label: 'ops'
    })
    expect(r.success).toBe(true)
  })

  it('rejects invalid pubkey', () => {
    const r = addAdminSchema.safeParse({ pubkey: 'z' })
    expect(r.success).toBe(false)
  })

  it('discriminates nostr commands by op', () => {
    const status = nostrCommandSchema.safeParse({ id: '1', op: 'status' })
    expect(status.success).toBe(true)

    const bogus = nostrCommandSchema.safeParse({ id: '1', op: 'nonsense' })
    expect(bogus.success).toBe(false)
  })
})
