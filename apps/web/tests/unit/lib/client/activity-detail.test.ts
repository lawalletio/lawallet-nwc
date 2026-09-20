import { afterEach, describe, expect, it } from 'vitest'
import {
  activityDetailBackHref,
  activityDetailHref,
  activityDetailTitle
} from '@/lib/client/activity-detail'

const HASH = 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e'

describe('activityDetailHref', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/')
  })
  it('encodes the payment hash into the detail route', () => {
    expect(activityDetailHref(HASH)).toBe(`/wallet/activity/${HASH}`)
  })

  it('tags home-originated rows so back returns to /wallet', () => {
    expect(activityDetailHref(HASH, 'home')).toBe(
      `/wallet/activity/${HASH}?from=home`
    )
  })

  it('keeps preview=1 on detail links during local preview', () => {
    window.history.replaceState({}, '', '/wallet?preview=1')
    expect(activityDetailHref(HASH, 'home')).toBe(
      `/wallet/activity/${HASH}?from=home&preview=1`
    )
    window.history.replaceState({}, '', '/')
  })
})

describe('activityDetailBackHref', () => {
  it('returns home when the row was opened from the wallet preview', () => {
    expect(activityDetailBackHref('home')).toBe('/wallet')
  })

  it('returns the full activity list otherwise', () => {
    expect(activityDetailBackHref()).toBe('/wallet/activity')
    expect(activityDetailBackHref('activity')).toBe('/wallet/activity')
  })
})

describe('activityDetailTitle', () => {
  it('mirrors the post-flow summary titles for settled payments', () => {
    expect(activityDetailTitle('incoming', 'settled')).toBe('Payment received')
    expect(activityDetailTitle('outgoing', 'settled')).toBe('Payment sent')
  })

  it('uses a status title for pending and failed payments', () => {
    expect(activityDetailTitle('incoming', 'pending')).toBe('Payment pending')
    expect(activityDetailTitle('outgoing', 'failed')).toBe('Payment failed')
  })
})
