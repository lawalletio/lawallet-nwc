import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import {
  consumeNtag424FromPC,
  signNtag424Tap,
  Ntag424Error
} from '@/lib/ntag424'
import type { Ntag424 } from '@/types/ntag424'

// `signNtag424Tap` is the server-side inverse of `consumeNtag424FromPC` (used by
// the card emulator so keys never leave the server). These tests prove the two
// agree by signing a tap and validating it with the real consumer.

function fakeNtag(overrides: Partial<Ntag424> = {}): Ntag424 {
  return {
    cid: randomBytes(7).toString('hex'), // 7-byte NTAG424 UID
    k0: randomBytes(16).toString('hex'),
    k1: randomBytes(16).toString('hex'),
    k2: randomBytes(16).toString('hex'),
    k3: randomBytes(16).toString('hex'),
    k4: randomBytes(16).toString('hex'),
    ctr: 0,
    ...overrides
  } as Ntag424
}

describe('signNtag424Tap ↔ consumeNtag424FromPC', () => {
  it('produces a p/c the server accepts and decodes to the right counter', async () => {
    const ntag = fakeNtag()
    const { p, c } = await signNtag424Tap(ntag, 1)

    expect(p).toMatch(/^[A-F0-9]{32}$/)
    expect(c).toMatch(/^[A-F0-9]{16}$/)

    const res = await consumeNtag424FromPC(ntag, p, c)
    expect('ok' in res).toBe(true)
    if ('ok' in res) {
      expect(res.ctrOld).toBe(0)
      expect(res.ctrNew).toBe(1)
    }
  })

  it('round-trips across several counter values', async () => {
    const ntag = fakeNtag()
    for (const ctr of [1, 42, 100, 65535, 16777215]) {
      const { p, c } = await signNtag424Tap(ntag, ctr)
      const res = await consumeNtag424FromPC({ ...ntag, ctr: ctr - 1 }, p, c)
      expect('ok' in res, `ctr ${ctr}`).toBe(true)
      if ('ok' in res) expect(res.ctrNew).toBe(ctr)
    }
  })

  it('is rejected as too-old when the counter does not advance', async () => {
    const ntag = fakeNtag({ ctr: 5 })
    const { p, c } = await signNtag424Tap(ntag, 5)
    const res = await consumeNtag424FromPC(ntag, p, c)
    expect(res).toEqual({ error: Ntag424Error.MALFORMED_P__COUNTER_VALUE_TOO_OLD })
  })

  it('only requires cid/k1/k2 to sign', async () => {
    const ntag = fakeNtag()
    const { p, c } = await signNtag424Tap(
      { cid: ntag.cid, k1: ntag.k1, k2: ntag.k2 },
      1
    )
    const res = await consumeNtag424FromPC(ntag, p, c)
    expect('ok' in res).toBe(true)
  })
})
