import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { clearSessionCaches } from '@/lib/client/cache/session-cache'
import { writeBalance } from '@/lib/client/cache/balance-cache'
import { readRecent, upsertMany } from '@/lib/client/cache/activity-cache'
import { __resetIdbForTests } from '@/lib/client/cache/idb'
import {
  __resetContactsCacheForTests,
  contactsActions
} from '@/lib/client/contacts-store'
import {
  __resetCurrenciesCacheForTests,
  currenciesActions
} from '@/lib/client/currencies-store'

const NWC_KEY = 'aaaaaaaaaaaaaaaa'

describe('session cache cleanup', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    globalThis.indexedDB = new IDBFactory()
    __resetIdbForTests()
    __resetContactsCacheForTests()
    __resetCurrenciesCacheForTests()
  })

  it('wipes account data from memory, storage, IndexedDB, and CacheStorage', async () => {
    const deleteCache = vi.fn(async () => true)
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: {
        keys: vi.fn(async () => [
          'lawallet-api-v2',
          'lawallet-pages-v2',
          'lawallet-static-v2'
        ]),
        delete: deleteCache
      }
    })

    writeBalance(NWC_KEY, 21)
    contactsActions.add({
      name: 'Alice',
      lightningAddress: 'alice@example.com'
    })
    currenciesActions.add('USD')
    window.localStorage.setItem('lawallet-nostr-profiles', '{"alice":{}}')
    // Device-wide appearance is a preference, not authenticated account data.
    window.localStorage.setItem('lawallet-theme-color', '#123456')
    window.sessionStorage.setItem('lawallet:pending-invoice', '{"id":"old"}')
    window.sessionStorage.setItem('lawallet:first-load-done', '1')
    await upsertMany(NWC_KEY, [
      {
        type: 'incoming',
        amountSats: 21,
        feesPaidSats: 0,
        description: 'old payment',
        paymentHash: 'hash',
        preimage: null,
        settledAt: null,
        createdAt: 1
      }
    ])

    await clearSessionCaches()

    expect(
      window.localStorage.getItem(`lawallet-balance:${NWC_KEY}`)
    ).toBeNull()
    expect(window.localStorage.getItem('lawallet-contacts')).toBeNull()
    expect(window.localStorage.getItem('lawallet-active-currencies')).toBeNull()
    expect(window.localStorage.getItem('lawallet-nostr-profiles')).toBeNull()
    expect(window.localStorage.getItem('lawallet-theme-color')).toBe('#123456')
    expect(window.sessionStorage.getItem('lawallet:pending-invoice')).toBeNull()
    expect(window.sessionStorage.getItem('lawallet:first-load-done')).toBeNull()
    expect(await readRecent(NWC_KEY)).toEqual([])
    expect(deleteCache).toHaveBeenCalledWith('lawallet-api-v2')
    expect(deleteCache).toHaveBeenCalledWith('lawallet-pages-v2')
    expect(deleteCache).not.toHaveBeenCalledWith('lawallet-static-v2')
  })
})
