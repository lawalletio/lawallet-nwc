import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nip19 } from 'nostr-tools'

import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { resolveProfiles } from '@/lib/nostr/profile-cache'

const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)
const NPUB_A = nip19.npubEncode(PUBKEY_A)
const NOW = new Date('2026-07-01T12:00:00.000Z')

function kind0(pubkey: string, created_at: number, meta: Record<string, unknown>) {
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
    ...overrides,
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.nostrProfileCache.upsert).mockResolvedValue({} as any)
})

describe('resolveProfiles', () => {
  it('serves fresh cache without relay traffic', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([{ pubkey: PUBKEY_A }] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow(),
    ] as any)
    const relayFetcher = vi.fn()

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn(),
    })

    expect(relayFetcher).not.toHaveBeenCalled()
    expect(profiles).toMatchObject([{ pubkey: PUBKEY_A, name: 'cached' }])
  })

  it('revalidates stale cache and stores the newest kind-0 event', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([{ pubkey: PUBKEY_A }] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow({ fetchedAt: new Date('2026-06-01T00:00:00.000Z') }),
    ] as any)
    const relayFetcher = vi.fn().mockResolvedValue([
      kind0(PUBKEY_A, 100, { name: 'old' }),
      kind0(PUBKEY_A, 200, { name: 'new', picture: 'https://cdn.example.com/a.png' }),
    ])
    const precacheImages = vi.fn().mockResolvedValue(undefined)

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      relayFetcher,
      precacheImages,
    })

    expect(relayFetcher).toHaveBeenCalledWith([PUBKEY_A])
    expect(profiles).toMatchObject([{ name: 'new', picture: 'https://cdn.example.com/a.png' }])
    expect(prismaMock.nostrProfileCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { npub: NPUB_A },
        update: expect.objectContaining({
          name: 'new',
          kind0CreatedAt: new Date(200 * 1000),
          fetchedAt: NOW,
          lastFetchError: null,
        }),
      }),
    )
    expect(precacheImages).toHaveBeenCalled()
  })

  it('force revalidates even when cache is fresh', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([{ pubkey: PUBKEY_A }] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow(),
    ] as any)
    const relayFetcher = vi.fn().mockResolvedValue([
      kind0(PUBKEY_A, 300, { name: 'forced' }),
    ])

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      force: true,
      relayFetcher,
      precacheImages: vi.fn(),
    })

    expect(relayFetcher).toHaveBeenCalledWith([PUBKEY_A])
    expect(profiles[0].name).toBe('forced')
  })

  it('preserves stale cache when relay fetch fails', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([{ pubkey: PUBKEY_A }] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([
      cacheRow({ fetchedAt: new Date('2026-06-01T00:00:00.000Z') }),
    ] as any)
    const relayFetcher = vi.fn().mockRejectedValue(new Error('relay down'))

    const profiles = await resolveProfiles([PUBKEY_A], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn(),
    })

    expect(profiles).toMatchObject([{ name: 'cached', stale: true }])
    expect(prismaMock.nostrProfileCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { npub: NPUB_A },
        update: expect.objectContaining({
          lastFetchAttemptAt: NOW,
          lastFetchError: 'relay down',
        }),
      }),
    )
  })

  it('ignores pubkeys that are not registered users', async () => {
    vi.mocked(prismaMock.user.findMany).mockResolvedValue([{ pubkey: PUBKEY_A }] as any)
    vi.mocked(prismaMock.nostrProfileCache.findMany).mockResolvedValue([])
    const relayFetcher = vi.fn().mockResolvedValue([
      kind0(PUBKEY_A, 100, { name: 'alice' }),
      kind0(PUBKEY_B, 100, { name: 'bob' }),
    ])

    const profiles = await resolveProfiles([PUBKEY_A, PUBKEY_B], {
      now: NOW,
      relayFetcher,
      precacheImages: vi.fn(),
    })

    expect(relayFetcher).toHaveBeenCalledWith([PUBKEY_A])
    expect(profiles).toHaveLength(1)
    expect(profiles[0].pubkey).toBe(PUBKEY_A)
  })
})
