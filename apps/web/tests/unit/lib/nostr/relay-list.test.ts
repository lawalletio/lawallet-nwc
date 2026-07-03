import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

import {
  parseNip65Relays,
  parseStoredRelays,
  resolveUserRelays,
} from '@/lib/nostr/relay-list'

const PUBKEY = 'a'.repeat(64)
const NOW = new Date('2026-07-02T00:00:00Z')
const FRESH = new Date(NOW.getTime() - 60_000) // 1 min ago (< 6h TTL)
const STALE = new Date(NOW.getTime() - 7 * 60 * 60 * 1000) // 7h ago (> 6h TTL)

beforeEach(() => resetPrismaMock())

describe('parseNip65Relays', () => {
  it('extracts ws/wss relay URLs from r tags, ignoring markers, dupes, and other tags', () => {
    expect(
      parseNip65Relays([
        ['r', 'wss://lacrypta.ar'],
        ['r', 'wss://relay.damus.io', 'read'],
        ['r', 'wss://LaCrypta.ar/'], // dupe (case + trailing slash)
        ['r', 'https://not-a-relay.example'], // wrong protocol
        ['p', 'wss://ignored.example'], // wrong tag
      ]),
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
        relaysUpdatedAt: FRESH,
      },
      { db: prismaMock, now: NOW, fetcher },
    )
    expect(out).toEqual(['wss://nos.lol'])
    expect(fetcher).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('fetches the NIP-65 list when stale/empty and persists it into relays', async () => {
    fetcher.mockResolvedValue([
      { pubkey: PUBKEY, created_at: 100, tags: [['r', 'wss://lacrypta.ar'], ['r', 'wss://nos.lol']] },
    ])
    vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)

    const out = await resolveUserRelays(
      { id: 'u1', pubkey: PUBKEY, relays: null, relaysUpdatedAt: null },
      { db: prismaMock, now: NOW, fetcher },
    )

    expect(out).toEqual(['wss://lacrypta.ar', 'wss://nos.lol'])
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: {
          relays: JSON.stringify(['wss://lacrypta.ar', 'wss://nos.lol']),
          relaysUpdatedAt: NOW,
        },
      }),
    )
  })

  it('keeps a manual list when no NIP-65 is found, only stamping the check', async () => {
    fetcher.mockResolvedValue([])
    vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)

    const out = await resolveUserRelays(
      {
        id: 'u1',
        pubkey: PUBKEY,
        relays: JSON.stringify(['wss://manual.example']),
        relaysUpdatedAt: STALE,
      },
      { db: prismaMock, now: NOW, fetcher },
    )

    expect(out).toEqual(['wss://manual.example'])
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { relaysUpdatedAt: NOW } }),
    )
  })

  it('picks the newest kind:10002 event when several are returned', async () => {
    fetcher.mockResolvedValue([
      { pubkey: PUBKEY, created_at: 50, tags: [['r', 'wss://old.example']] },
      { pubkey: PUBKEY, created_at: 200, tags: [['r', 'wss://new.example']] },
    ])
    vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)

    const out = await resolveUserRelays(
      { id: 'u1', pubkey: PUBKEY, relays: null, relaysUpdatedAt: null },
      { db: prismaMock, now: NOW, fetcher },
    )
    expect(out).toEqual(['wss://new.example'])
  })

  it('falls back to the stored value (no throw) when the fetch errors', async () => {
    const failing = vi.fn(async () => {
      throw new Error('relay down')
    })
    const out = await resolveUserRelays(
      { id: 'u1', pubkey: PUBKEY, relays: null, relaysUpdatedAt: null },
      { db: prismaMock, now: NOW, fetcher: failing },
    )
    expect(out).toEqual([])
  })
})
