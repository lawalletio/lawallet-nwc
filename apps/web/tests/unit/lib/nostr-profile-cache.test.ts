import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nip19 } from 'nostr-tools'

import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { resolveProfiles } from '@/lib/nostr/profile-cache'
import { precacheProfileImages } from '@/lib/nostr/profile-image-cache'

vi.mock('@/lib/nostr/profile-image-cache', () => ({
  precacheProfileImages: vi.fn()
}))

const poolMock = vi.hoisted(() => ({
  querySync: vi.fn(),
  close: vi.fn()
}))
vi.mock('nostr-tools/pool', () => ({
  SimplePool: vi.fn(function () {
    return poolMock
  })
}))

const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)
const PUBKEY_C = 'c'.repeat(64)
const NPUB_A = nip19.npubEncode(PUBKEY_A)
const NPUB_B = nip19.npubEncode(PUBKEY_B)
const NPUB_C = nip19.npubEncode(PUBKEY_C)
const NOW = new Date('2026-07-01T12:00:00.000Z')

function kind0(
  pubkey: string,
  created_at: number,
  meta: Record<string, unknown>
) {
  return { pubkey, created_at, content: JSON.stringify(meta) }
}

function cacheRow(overrides: Record<string, unknown> = {}) {
  return {
    npub: NPUB_A,
    pubkey: PUBKEY_A,
    name: 'cached',
    displayName: null,
    about: null,
    nip05: null,
    lud16: null,
    website: null,
    pictureUrl: null,
    bannerUrl: null,
    kind0CreatedAt: new Date('2026-06-20T00:00:00.000Z'),
    rawMetadata: { name: 'cached' },
    fetchedAt: new Date('2026-06-30T12:00:00.000Z'),
    lastFetchAttemptAt: new Date('2026-06-30T12:00:00.000Z'),
    lastFetchError: null,
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
    updatedAt: new Date('2026-06-30T12:00:00.000Z'),
    ...overrides
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.nostrProfileCache.upsert).mockResolvedValue({} as any)
  // Registration is resolved from User.pubkey ∪ NostrIdentity; default the
  // identity lookup to empty so tests opt in via User.pubkey as before.
  vi.mocked(prismaMock.nostrIdentity.findMany).mockResolvedValue([] as any)
  // Vouchers also make a pubkey resolvable (a merchant or coupon service is
  // never an account here). Default to none so these tests keep exercising
  // the account paths only.
  vi.mocked(prismaMock.voucher.findMany).mockResolvedValue([] as any)
})

describe('resolveProfiles', () => {
  it('serves fresh cache without relay traffic', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow()
    ] as any)
    const relayFetcher = vi.fn()

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn()
    })

    expect(relayFetcher).not.toHaveBeenCalled()
    expect(profiles).toMatchObject([{ pubkey: PUBKEY_A, name: 'cached' }])
  })

  it('resolves a secondary identity pubkey not mirrored on User.pubkey', async () => {
    // The pubkey belongs to an account only via NostrIdentity (a linked
    // secondary), so User.pubkey does not match — it must still resolve.
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([] as any)
    vi.mocked(prismaMock.nostrIdentity.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow()
    ] as any)
    const relayFetcher = vi.fn()

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn()
    })

    expect(profiles).toMatchObject([{ pubkey: PUBKEY_A, name: 'cached' }])
  })

  it('omits a pubkey linked to no account (not a relay proxy)', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([] as any)
    vi.mocked(prismaMock.nostrIdentity.findMany).mockResolvedValue([] as any)
    const relayFetcher = vi.fn()

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn()
    })

    expect(relayFetcher).not.toHaveBeenCalled()
    expect(profiles).toEqual([])
  })

  it('revalidates stale cache and stores the newest kind-0 event', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow({ fetchedAt: new Date('2026-06-01T00:00:00.000Z') })
    ] as any)
    const relayFetcher = vi.fn().mockResolvedValue([
      kind0(PUBKEY_A, 100, { name: 'old' }),
      kind0(PUBKEY_A, 200, {
        name: 'new',
        picture: 'https://cdn.example.com/a.png'
      })
    ])
    const precacheImages = vi.fn().mockResolvedValue(undefined)

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      relayFetcher,
      precacheImages
    })

    expect(relayFetcher).toHaveBeenCalledWith([PUBKEY_A])
    expect(profiles).toMatchObject([
      { name: 'new', picture: 'https://cdn.example.com/a.png' }
    ])
    expect(prismaMock.nostrProfileCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { npub: NPUB_A },
        update: expect.objectContaining({
          name: 'new',
          kind0CreatedAt: new Date(200 * 1000),
          fetchedAt: NOW,
          lastFetchError: null
        })
      })
    )
    expect(precacheImages).toHaveBeenCalled()
  })

  it('force revalidates even when cache is fresh', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow()
    ] as any)
    const relayFetcher = vi
      .fn()
      .mockResolvedValue([kind0(PUBKEY_A, 300, { name: 'forced' })])

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      force: true,
      relayFetcher,
      precacheImages: vi.fn()
    })

    expect(relayFetcher).toHaveBeenCalledWith([PUBKEY_A])
    expect(profiles[0].name).toBe('forced')
  })

  it('preserves stale cache when relay fetch fails', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow({ fetchedAt: new Date('2026-06-01T00:00:00.000Z') })
    ] as any)
    const relayFetcher = vi.fn().mockRejectedValue(new Error('relay down'))

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn()
    })

    expect(profiles).toMatchObject([{ name: 'cached', stale: true }])
    expect(prismaMock.nostrProfileCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { npub: NPUB_A },
        update: expect.objectContaining({
          lastFetchAttemptAt: NOW,
          lastFetchError: 'relay down'
        })
      })
    )
  })

  it('ignores pubkeys that are not registered users', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([])
    const relayFetcher = vi
      .fn()
      .mockResolvedValue([
        kind0(PUBKEY_A, 100, { name: 'alice' }),
        kind0(PUBKEY_B, 100, { name: 'bob' })
      ])

    const profiles = await resolveProfiles([PUBKEY_A, PUBKEY_B], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn()
    })

    expect(relayFetcher).toHaveBeenCalledWith([PUBKEY_A])
    expect(profiles).toHaveLength(1)
    expect(profiles[0].pubkey).toBe(PUBKEY_A)
  })

  it('resolves a merchant or coupon service referenced by a stored voucher', async () => {
    // Neither is an account here, but both are already in our database
    // because somebody deposited a coupon naming them — so resolving them
    // leaks nothing new, and it is what puts a real name on the voucher page.
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([] as any)
    vi.mocked(prismaMock.voucher.findMany).mockResolvedValue([
      { merchantPubkey: PUBKEY_B, servicePubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([])
    const relayFetcher = vi
      .fn()
      .mockResolvedValue([kind0(PUBKEY_B, 100, { name: 'cafe' })])

    const profiles = await resolveProfiles([PUBKEY_B], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn()
    })

    expect(relayFetcher).toHaveBeenCalledWith([PUBKEY_B])
    expect(profiles.map(p => p.pubkey)).toEqual([PUBKEY_B])
  })

  it('still refuses a pubkey nothing in the database references', async () => {
    // The anti-relay-proxy property: widening for vouchers must not make this
    // endpoint resolve arbitrary keys.
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([] as any)
    vi.mocked(prismaMock.voucher.findMany).mockResolvedValue([] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([])
    const relayFetcher = vi.fn()

    const profiles = await resolveProfiles([PUBKEY_B], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn()
    })

    expect(relayFetcher).not.toHaveBeenCalled()
    expect(profiles).toHaveLength(0)
  })
  it('persists success, not-found and invalid-metadata pubkeys in one batch', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A },
      { pubkey: PUBKEY_B },
      { pubkey: PUBKEY_C }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([])
    const relayFetcher = vi
      .fn()
      .mockResolvedValue([
        kind0(PUBKEY_A, 100, { name: 'alice' }),
        { pubkey: PUBKEY_C, created_at: 100, content: 'not json' }
      ])
    const precacheImages = vi.fn().mockResolvedValue(undefined)

    const profiles = await resolveProfiles([PUBKEY_A, PUBKEY_B, PUBKEY_C], {
      now: NOW,
      relayFetcher,
      precacheImages
    })

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prismaMock.$transaction).mock.calls[0][0]).toHaveLength(3)
    expect(prismaMock.nostrProfileCache.upsert).toHaveBeenCalledTimes(3)
    expect(prismaMock.nostrProfileCache.upsert).toHaveBeenCalledWith({
      where: { npub: NPUB_A },
      create: expect.objectContaining({
        npub: NPUB_A,
        pubkey: PUBKEY_A,
        name: 'alice',
        rawMetadata: { name: 'alice' },
        fetchedAt: NOW,
        lastFetchAttemptAt: NOW,
        lastFetchError: null
      }),
      update: expect.not.objectContaining({ npub: expect.anything() })
    })
    expect(prismaMock.nostrProfileCache.upsert).toHaveBeenCalledWith({
      where: { npub: NPUB_B },
      create: {
        npub: NPUB_B,
        pubkey: PUBKEY_B,
        lastFetchAttemptAt: NOW,
        lastFetchError: 'Profile not found on relays'
      },
      update: {
        lastFetchAttemptAt: NOW,
        lastFetchError: 'Profile not found on relays'
      }
    })
    expect(prismaMock.nostrProfileCache.upsert).toHaveBeenCalledWith({
      where: { npub: NPUB_C },
      create: {
        npub: NPUB_C,
        pubkey: PUBKEY_C,
        lastFetchAttemptAt: NOW,
        lastFetchError: 'Invalid kind-0 metadata'
      },
      update: {
        lastFetchAttemptAt: NOW,
        lastFetchError: 'Invalid kind-0 metadata'
      }
    })
    expect(profiles.map(p => p.pubkey)).toEqual([PUBKEY_A])
    expect(precacheImages).toHaveBeenCalledTimes(1)
    expect(precacheImages).toHaveBeenCalledWith(
      expect.objectContaining({ pubkey: PUBKEY_A })
    )
  })

  it('marks every pubkey failed in one batch when the relay fetch throws', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A },
      { pubkey: PUBKEY_B }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([])
    const relayFetcher = vi.fn().mockRejectedValue(new Error('relay down'))
    const precacheImages = vi.fn()

    const profiles = await resolveProfiles([PUBKEY_A, PUBKEY_B], {
      now: NOW,
      relayFetcher,
      precacheImages
    })

    expect(profiles).toEqual([])
    expect(precacheImages).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prismaMock.$transaction).mock.calls[0][0]).toHaveLength(2)
    for (const [npub, pubkey] of [
      [NPUB_A, PUBKEY_A],
      [NPUB_B, PUBKEY_B]
    ]) {
      expect(prismaMock.nostrProfileCache.upsert).toHaveBeenCalledWith({
        where: { npub },
        create: {
          npub,
          pubkey,
          lastFetchAttemptAt: NOW,
          lastFetchError: 'relay down'
        },
        update: { lastFetchAttemptAt: NOW, lastFetchError: 'relay down' }
      })
    }
  })

  it('marks every pubkey failed and refreshes nothing when the batch write fails', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([])
    vi.mocked(prismaMock.$transaction)
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce([] as any)
    const relayFetcher = vi
      .fn()
      .mockResolvedValue([kind0(PUBKEY_A, 100, { name: 'alice' })])
    const precacheImages = vi.fn()

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      relayFetcher,
      precacheImages
    })

    expect(profiles).toEqual([])
    expect(precacheImages).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2)
    expect(prismaMock.nostrProfileCache.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { npub: NPUB_A },
        update: { lastFetchAttemptAt: NOW, lastFetchError: 'db down' }
      })
    )
  })
  it('commits a large batch in chunks so no transaction outruns its timeout', async () => {
    const pubkeys = Array.from({ length: 120 }, (_, i) =>
      i.toString(16).padStart(64, '0')
    )
    vi.mocked(prismaMock.user.findMany).mockResolvedValue(
      pubkeys.map(pubkey => ({ pubkey })) as any
    )
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([])
    const relayFetcher = vi.fn().mockResolvedValue([])

    await resolveProfiles(pubkeys, { now: NOW, relayFetcher })

    const sizes = vi
      .mocked(prismaMock.$transaction)
      .mock.calls.map(([writes]) => (writes as unknown as unknown[]).length)
    expect(sizes).toEqual([50, 50, 20])
  })

  it('resolves instead of throwing when recording the failure also fails', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([])
    vi.mocked(prismaMock.$transaction).mockRejectedValue(
      new Error('expired transaction')
    )
    const relayFetcher = vi
      .fn()
      .mockResolvedValue([kind0(PUBKEY_A, 100, { name: 'alice' })])

    await expect(
      resolveProfiles([PUBKEY_A], { now: NOW, relayFetcher })
    ).resolves.toEqual([])
  })

  it('stores null for missing fields and precaches with the default helper', async () => {
    vi.mocked(precacheProfileImages).mockResolvedValue(undefined)
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([])
    const relayFetcher = vi
      .fn()
      .mockResolvedValue([kind0(PUBKEY_A, 100, { about: 'hi' })])

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      relayFetcher
    })

    expect(profiles).toMatchObject([{ pubkey: PUBKEY_A, about: 'hi' }])
    expect(prismaMock.nostrProfileCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ name: null, about: 'hi' })
      })
    )
    expect(precacheProfileImages).toHaveBeenCalledWith(
      expect.objectContaining({ pubkey: PUBKEY_A })
    )
  })

  it('skips a pubkey whose last failed fetch is inside the backoff window', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow({
        fetchedAt: null,
        lastFetchAttemptAt: new Date(NOW.getTime() - 5 * 60 * 1000),
        lastFetchError: 'Profile not found on relays'
      })
    ] as any)
    const relayFetcher = vi.fn()

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn()
    })

    expect(relayFetcher).not.toHaveBeenCalled()
    expect(profiles).toEqual([])
  })

  it('retries a failed pubkey once the backoff window has passed', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow({
        fetchedAt: null,
        lastFetchAttemptAt: new Date(NOW.getTime() - 11 * 60 * 1000)
      })
    ] as any)
    const relayFetcher = vi
      .fn()
      .mockResolvedValue([kind0(PUBKEY_A, 100, { name: 'back' })])

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn()
    })

    expect(relayFetcher).toHaveBeenCalledWith([PUBKEY_A])
    expect(profiles[0].name).toBe('back')
  })

  it('serves stale cache without awaiting relays and refreshes in the scheduled task', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A },
      { pubkey: PUBKEY_B }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow({
        fetchedAt: new Date('2026-06-01T00:00:00.000Z'),
        lastFetchAttemptAt: new Date('2026-06-01T00:00:00.000Z')
      })
    ] as any)
    // B has no cached row, so it blocks; A is stale, so it's deferred.
    const relayFetcher = vi.fn(async (pubkeys: string[]) =>
      pubkeys.map(pk => kind0(pk, 100, { name: `new-${pk[0]}` }))
    )
    const tasks: Array<() => Promise<void>> = []

    const profiles = await resolveProfiles([PUBKEY_A, PUBKEY_B], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn().mockResolvedValue(undefined),
      schedule: task => tasks.push(task)
    })

    expect(relayFetcher).toHaveBeenCalledTimes(1)
    expect(relayFetcher).toHaveBeenCalledWith([PUBKEY_B])
    expect(profiles).toMatchObject([
      { pubkey: PUBKEY_A, name: 'cached', stale: true },
      { pubkey: PUBKEY_B, name: 'new-b' }
    ])
    expect(tasks).toHaveLength(1)

    await tasks[0]()
    expect(relayFetcher).toHaveBeenLastCalledWith([PUBKEY_A])
    expect(prismaMock.nostrProfileCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { npub: NPUB_A },
        update: expect.objectContaining({ name: 'new-a' })
      })
    )
  })

  it('force blocks on relays even with a scheduler', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([
      { pubkey: PUBKEY_A }
    ] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow()
    ] as any)
    const relayFetcher = vi
      .fn()
      .mockResolvedValue([kind0(PUBKEY_A, 300, { name: 'forced' })])
    const schedule = vi.fn()

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      force: true,
      relayFetcher,
      precacheImages: vi.fn(),
      schedule
    })

    expect(schedule).not.toHaveBeenCalled()
    expect(profiles[0].name).toBe('forced')
  })

  describe('default relay fetcher', () => {
    beforeEach(() => {
      vi.mocked(prismaMock.user.findMany).mockResolvedValue([
        { pubkey: PUBKEY_A }
      ] as any)
      vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([])
    })

    it('bounds querySync with maxWait and returns its events', async () => {
      poolMock.querySync.mockResolvedValue([
        { ...kind0(PUBKEY_A, 100, { name: 'relay' }), id: 'x' }
      ])

      const profiles = await resolveProfiles([PUBKEY_A], {
        now: NOW,
        precacheImages: vi.fn().mockResolvedValue(undefined)
      })

      expect(poolMock.querySync).toHaveBeenCalledWith(
        expect.any(Array),
        { kinds: [0], authors: [PUBKEY_A] },
        { maxWait: 2_500 }
      )
      expect(profiles[0].name).toBe('relay')
      expect(poolMock.close).toHaveBeenCalled()
    })

    it('gives up after the timeout and records the failure', async () => {
      vi.useFakeTimers()
      try {
        poolMock.querySync.mockReturnValue(new Promise(() => {}))

        const pending = resolveProfiles([PUBKEY_A], {
          now: NOW,
          precacheImages: vi.fn()
        })
        await vi.advanceTimersByTimeAsync(3_000)
        const profiles = await pending

        expect(profiles).toEqual([])
        expect(prismaMock.nostrProfileCache.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { npub: NPUB_A },
            update: {
              lastFetchAttemptAt: NOW,
              lastFetchError: 'Relay query timed out'
            }
          })
        )
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
