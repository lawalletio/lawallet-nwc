import { describe, it, expect, beforeEach, vi } from 'vitest'
import { verifyEvent } from 'nostr-tools/pure'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

import {
  devMint,
  devMintRandom,
  devPreview,
  devRefresh,
  devServicePubkey
} from '@/lib/dev/coupon-service'

function mint(overrides: Partial<Parameters<typeof devMint>[0]> = {}) {
  return devMint({
    merchantPubkey: 'c'.repeat(64),
    name: 'Test coupon',
    description: 'For tests.',
    image: null,
    benefit: { type: 'percent', percent: 20 },
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides
  })
}

let key = 0
const nextKey = () => `key-${++key}`

beforeEach(() => {
  key = 0
})

describe('dev coupon service — mint', () => {
  it('signs a verifiable 20402 naming the merchant in `p`', () => {
    const minted = mint()
    const event = minted.voucher

    expect(event.kind).toBe(20402)
    expect(verifyEvent(event)).toBe(true)
    expect(event.pubkey).toBe(devServicePubkey())
    // `p` is the merchant, never the holder — the protocol has no holder.
    expect(event.tags.find(t => t[0] === 'p')?.[1]).toBe('c'.repeat(64))
    expect(event.tags.find(t => t[0] === 'nonce')?.[1]).toBe(minted.nonce)
  })

  it('mints a 22-character base64url nonce, as the protocol pins', () => {
    expect(mint().nonce).toHaveLength(22)
  })

  it('covers every benefit shape across the random catalog', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      seen.add((devMintRandom().coupon as { type: string }).type)
    }
    expect(seen).toContain('percent')
    expect(seen).toContain('multibuy')
    expect(seen).toContain('fixed')
    expect(seen).toContain('freeItems')
    expect(seen).toContain('buyXgetY')
    // Deliberately includes one the UI cannot summarize, so the fallback
    // rendering is reachable from the dev button.
    expect(seen).toContain('quantumDiscount')
  })
})

describe('dev coupon service — refresh', () => {
  it('burns the old nonce and mints a different one', () => {
    const minted = mint()
    const result = devRefresh(minted.nonce, nextKey())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.response.nonce).not.toBe(minted.nonce)
    expect(devPreview(minted.nonce)?.status).toBe('refreshed')
    expect(devPreview(result.response.nonce)?.status).toBe('minted')
  })

  it('preserves the benefit snapshot and the expiry', () => {
    // Refresh must not be an expiry extension, and must not re-derive the
    // benefit — that would break freeze-at-mint.
    const minted = mint()
    const result = devRefresh(minted.nonce, nextKey())
    if (!result.ok) throw new Error('expected success')

    expect(result.response.expiresAt).toBe(minted.expiresAt)
    expect(result.response.coupon).toEqual(minted.coupon)
    expect(result.response.couponId).toBe(minted.couponId)
  })

  it('replays the identical response for a repeated key', () => {
    const minted = mint()
    const k = nextKey()
    const first = devRefresh(minted.nonce, k)
    const second = devRefresh(minted.nonce, k)
    if (!first.ok || !second.ok) throw new Error('expected success')

    expect(second.replayed).toBe(true)
    expect(second.response.nonce).toBe(first.response.nonce)
    // Byte-identical, not re-signed: a different event id would break a
    // receiver that already stored the first response as provenance.
    expect(second.response.voucher.id).toBe(first.response.voucher.id)
  })

  it('gives a second caller a conflict, not a second replacement', () => {
    // The double-issue bug: if a missing or differing key returned the
    // existing replacement, two racing receivers would both be handed the
    // same live nonce.
    const minted = mint()
    const first = devRefresh(minted.nonce, nextKey())
    const rival = devRefresh(minted.nonce, nextKey())

    expect(first.ok).toBe(true)
    expect(rival.ok).toBe(false)
    if (rival.ok) return
    expect(rival.status).toBe(409)
  })

  it('refuses an unknown nonce', () => {
    const result = devRefresh('nope', nextKey())
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('refuses an expired coupon', () => {
    const minted = mint({ expiresAt: Math.floor(Date.now() / 1000) - 10 })
    expect(devRefresh(minted.nonce, nextKey())).toMatchObject({
      ok: false,
      status: 410
    })
  })
})
