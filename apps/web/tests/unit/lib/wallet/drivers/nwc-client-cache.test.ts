import { describe, it, expect, vi, beforeEach } from 'vitest'

const closed = vi.hoisted(() => [] as string[])

vi.mock('@getalby/sdk', () => {
  class FakeNWCClient {
    url: string
    constructor(opts: { nostrWalletConnectUrl: string }) {
      this.url = opts.nostrWalletConnectUrl
    }
    close() {
      closed.push(this.url)
    }
  }
  return { NWCClient: FakeNWCClient }
})

import {
  closeAllServerNwcClients,
  getServerNwcClient,
  MAX_CACHED_NWC_CLIENTS
} from '@/lib/wallet/drivers/nwc-client-cache'

beforeEach(() => {
  closeAllServerNwcClients()
  closed.length = 0
})

describe('getServerNwcClient LRU', () => {
  it('memoises one client per connection string', async () => {
    const a = await getServerNwcClient('conn-a')
    expect(await getServerNwcClient('conn-a')).toBe(a)
  })

  it('closes the least recently used client past the cap', async () => {
    for (let i = 0; i < MAX_CACHED_NWC_CLIENTS; i++) {
      await getServerNwcClient(`conn-${i}`)
    }
    // Touch conn-0 so conn-1 becomes the least recently used.
    const first = await getServerNwcClient('conn-0')
    await getServerNwcClient('conn-new')

    expect(closed).toEqual(['conn-1'])
    expect(await getServerNwcClient('conn-0')).toBe(first)
    // An evicted string gets a fresh client, which pushes out the next oldest.
    await getServerNwcClient('conn-1')
    expect(closed).toEqual(['conn-1', 'conn-2'])
  })
})
