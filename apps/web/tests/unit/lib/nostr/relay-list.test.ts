import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

import {
  parseNip65Relays,
  parseStoredRelays,
  resolveUserRelays
} from '@/lib/nostr/relay-list'

const PUBKEY = 'a'.repeat(64)
const NOW = new Date('2026-07-02T00:00:00Z')
const FRESH = new Date(NOW.getTime() - 60_000) // 1 min ago (< 6h TTL)
const STALE = new Date(NOW.getTime() - 7 * 60 * 60 * 1000) // 7h ago (> 6h TTL)
const RECENT_ATTEMPT = new Date(NOW.getTime() - 30_000) // 30s ago (< 60s backoff)
const EXPIRED_ATTEMPT = new Date(NOW.getTime() - 61_000) // 61s ago (> 60s backoff)

beforeEach(() => resetPrismaMock())

describe('parseNip65Relays', () => {
  it('extracts ws/wss relay URLs from r tags, ignoring markers, dupes, and other tags', () => {
    expect(
      parseNip65Relays([
        ['r', 'wss://lacrypta.ar'],
        ['r', 'wss://relay.damus.io', 'read'],
        ['r', 'wss://LaCrypta.ar/'], // dupe (case + trailing slash)
        ['r', 'https://not-a-relay.example'], // wrong protocol
        ['p', 'wss://ignored.example'] // wrong tag
      ])
    ).toEqual(['wss://lacrypta.ar', 'wss://relay.damus.io'])
  })
})

describe('parseStoredRelays', () => {
  it('parses a JSON array, tolerating null and garbage', () => {
    expect(parseStoredRelays(JSON.stringify(['wss://a']))).toEqual(['wss://a'])
    expect(parseStoredRelays(null)).toEqual([])
    expect(parseStoredRelays('not json')).toEqual([])
  })
})

describe('resolveUserRelays', () => {
  const fetcher = vi.fn()
  beforeEach(() => fetcher.mockReset())

  it('serves the cached relays without fetching when fresh', async () => {
    const out = await resolveUserRelays(
      {
        id: 'u1',
        pubkey: PUBKEY,
        relays: JSON.stringify(['wss://nos.lol']),
        relaysUpdatedAt: FRESH
      },
      { db: prismaMock, now: NOW, fetcher }
    )
    expect(out).toEqual(['wss://nos.lol'])
    expect(fetcher).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('fetches the NIP-65 list when stale/empty and persists it into relays', async () => {
    fetcher.mockResolvedValue([
      {
        pubkey: PUBKEY,
        created_at: 100,
        tags: [
          ['r', 'wss://lacrypta.ar'],
          ['r', 'wss://nos.lol']
        ]
      }
    ])
    vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)

    const out = await resolveUserRelays(
      { id: 'u1', pubkey: PUBKEY, relays: null, relaysUpdatedAt: null },
      { db: prismaMock, now: NOW, fetcher }
    )

    expect(out).toEqual(['wss://lacrypta.ar', 'wss://nos.lol'])
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: {
          relays: JSON.stringify(['wss://lacrypta.ar', 'wss://nos.lol']),
          relaysUpdatedAt: NOW,
          lastRelayFetchAttemptAt: NOW
        }
      })
    )
  })

  it('records the attempt (no freshness stamp) when no NIP-65 is found, keeping a manual list', async () => {
    fetcher.mockResolvedValue([])
    vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)

    const out = await resolveUserRelays(
      {
        id: 'u1',
        pubkey: PUBKEY,
        relays: JSON.stringify(['wss://manual.example']),
        relaysUpdatedAt: STALE,
        lastRelayFetchAttemptAt: EXPIRED_ATTEMPT
      },
      { db: prismaMock, now: NOW, fetcher }
    )

    expect(out).toEqual(['wss://manual.example'])
    // Records the attempt, but does NOT claim freshness — so a degraded
    // answer is retried after the short backoff rather than pinned for 6h.
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: { lastRelayFetchAttemptAt: NOW }
      })
    )
    const updateCall = (prismaMock.user.update as any).mock.calls[0][0]
    expect(updateCall.data).not.toHaveProperty('relays')
    expect(updateCall.data).not.toHaveProperty('relaysUpdatedAt')
  })

  it('records the attempt (no freshness stamp) when a relay failure yields [] (the shape querySync/withTimeout produce on failure)', async () => {
    // This is the shape a real relay failure produces: `nostr-tools`
    // `querySync` resolves `[]` (never rejects) and `withTimeout` resolves
    // `null` → `(events ?? [])` → `[]`. The previous code stamped
    // `relaysUpdatedAt = now` here, pinning the empty result for 6h.
    fetcher.mockResolvedValue([])
    vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)

    const out = await resolveUserRelays(
      {
        id: 'u1',
        pubkey: PUBKEY,
        relays: null,
        relaysUpdatedAt: null,
        lastRelayFetchAttemptAt: null
      },
      { db: prismaMock, now: NOW, fetcher }
    )

    expect(out).toEqual([])
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: { lastRelayFetchAttemptAt: NOW }
      })
    )
    const updateCall = (prismaMock.user.update as any).mock.calls[0][0]
    expect(updateCall.data).not.toHaveProperty('relaysUpdatedAt')
  })

  it('picks the newest kind:10002 event when several are returned', async () => {
    fetcher.mockResolvedValue([
      { pubkey: PUBKEY, created_at: 50, tags: [['r', 'wss://old.example']] },
      { pubkey: PUBKEY, created_at: 200, tags: [['r', 'wss://new.example']] }
    ])
    vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)

    const out = await resolveUserRelays(
      { id: 'u1', pubkey: PUBKEY, relays: null, relaysUpdatedAt: null },
      { db: prismaMock, now: NOW, fetcher }
    )
    expect(out).toEqual(['wss://new.example'])
  })

  it('falls back to the stored value (no throw) when the fetch errors', async () => {
    const failing = vi.fn(async () => {
      throw new Error('relay down')
    })
    vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)
    const out = await resolveUserRelays(
      { id: 'u1', pubkey: PUBKEY, relays: null, relaysUpdatedAt: null },
      { db: prismaMock, now: NOW, fetcher: failing }
    )
    expect(out).toEqual([])
    // An error (import/init) records the attempt like the empty branch does,
    // without claiming freshness — so the next request retries soon.
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: { lastRelayFetchAttemptAt: NOW }
      })
    )
    const updateCall = (prismaMock.user.update as any).mock.calls[0][0]
    expect(updateCall.data).not.toHaveProperty('relaysUpdatedAt')
  })

  it('serves stored relays without fetching when a recent attempt is on the short backoff window', async () => {
    const out = await resolveUserRelays(
      {
        id: 'u1',
        pubkey: PUBKEY,
        relays: JSON.stringify(['wss://stored.example']),
        relaysUpdatedAt: STALE,
        lastRelayFetchAttemptAt: RECENT_ATTEMPT
      },
      { db: prismaMock, now: NOW, fetcher }
    )
    expect(out).toEqual(['wss://stored.example'])
    expect(fetcher).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('serves stored (even empty) without fetching when a recent attempt exists and relaysUpdatedAt is stale', async () => {
    const out = await resolveUserRelays(
      {
        id: 'u1',
        pubkey: PUBKEY,
        relays: null,
        relaysUpdatedAt: null,
        lastRelayFetchAttemptAt: RECENT_ATTEMPT
      },
      { db: prismaMock, now: NOW, fetcher }
    )
    expect(out).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('re-fetches once the short backoff window elapses', async () => {
    fetcher.mockResolvedValue([
      {
        pubkey: PUBKEY,
        created_at: 100,
        tags: [['r', 'wss://recovered.example']]
      }
    ])
    vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)

    const out = await resolveUserRelays(
      {
        id: 'u1',
        pubkey: PUBKEY,
        relays: null,
        relaysUpdatedAt: null,
        lastRelayFetchAttemptAt: EXPIRED_ATTEMPT
      },
      { db: prismaMock, now: NOW, fetcher }
    )
    expect(out).toEqual(['wss://recovered.example'])
    expect(fetcher).toHaveBeenCalledWith([PUBKEY])
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          relays: JSON.stringify(['wss://recovered.example']),
          relaysUpdatedAt: NOW,
          lastRelayFetchAttemptAt: NOW
        }
      })
    )
  })

  it('forces a re-fetch (bypassing both the TTL and the backoff) when force is set', async () => {
    fetcher.mockResolvedValue([
      {
        pubkey: PUBKEY,
        created_at: 100,
        tags: [['r', 'wss://forced.example']]
      }
    ])
    vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)

    const out = await resolveUserRelays(
      {
        id: 'u1',
        pubkey: PUBKEY,
        relays: JSON.stringify(['wss://stored.example']),
        relaysUpdatedAt: FRESH,
        lastRelayFetchAttemptAt: RECENT_ATTEMPT
      },
      { db: prismaMock, now: NOW, force: true, fetcher }
    )
    expect(out).toEqual(['wss://forced.example'])
    expect(fetcher).toHaveBeenCalledWith([PUBKEY])
  })
})
