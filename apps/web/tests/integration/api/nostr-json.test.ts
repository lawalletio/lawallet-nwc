import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

import { GET, OPTIONS } from '@/app/.well-known/nostr.json/route'
import { DEFAULT_NOSTR_RELAYS } from '@/lib/nostr/profile'
import { getSettings } from '@/lib/settings'

const getSettingsMock = vi.mocked(getSettings)

const PK_ALICE = 'a'.repeat(64)
const PK_BOB = 'b'.repeat(64)

function url(name?: string) {
  const base = 'http://localhost:3000/.well-known/nostr.json'
  return name ? `${base}?name=${encodeURIComponent(name)}` : base
}

beforeEach(() => {
  resetPrismaMock()
  getSettingsMock.mockReset()
  getSettingsMock.mockResolvedValue({})
})

describe('GET /.well-known/nostr.json', () => {
  it('resolves a single name to its pubkey and advertises relays', async () => {
    vi.mocked(prismaMock.lightningAddress.findMany).mockResolvedValue([
      { username: 'alice', user: { pubkey: PK_ALICE } },
    ] as any)
    getSettingsMock.mockResolvedValue({
      relays: JSON.stringify(['wss://relay.one', 'wss://relay.two']),
    })

    const res = await GET(createNextRequest(url('Alice')) as any)
    const body = await res.json()

    expect(body.names).toEqual({ alice: PK_ALICE })
    expect(body.relays).toEqual({
      [PK_ALICE]: ['wss://relay.one', 'wss://relay.two'],
    })
    // lookups are case-insensitive
    expect(prismaMock.lightningAddress.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: 'alice' }, take: 1 }),
    )
  })

  it('falls back to default relays when the operator has none configured', async () => {
    vi.mocked(prismaMock.lightningAddress.findMany).mockResolvedValue([
      { username: 'alice', user: { pubkey: PK_ALICE } },
    ] as any)

    const res = await GET(createNextRequest(url('alice')) as any)
    const body = await res.json()

    expect(body.relays[PK_ALICE]).toEqual(DEFAULT_NOSTR_RELAYS)
  })

  it('ignores malformed relay settings and uses defaults', async () => {
    vi.mocked(prismaMock.lightningAddress.findMany).mockResolvedValue([
      { username: 'alice', user: { pubkey: PK_ALICE } },
    ] as any)
    getSettingsMock.mockResolvedValue({ relays: 'not-json' })

    const res = await GET(createNextRequest(url('alice')) as any)
    const body = await res.json()

    expect(body.relays[PK_ALICE]).toEqual(DEFAULT_NOSTR_RELAYS)
  })

  it('dedupes relay entries per pubkey when names share a pubkey', async () => {
    vi.mocked(prismaMock.lightningAddress.findMany).mockResolvedValue([
      { username: 'alice', user: { pubkey: PK_ALICE } },
      { username: 'bob', user: { pubkey: PK_BOB } },
      { username: 'alias', user: { pubkey: PK_ALICE } },
    ] as any)
    getSettingsMock.mockResolvedValue({ relays: JSON.stringify(['wss://relay.one']) })

    const res = await GET(createNextRequest(url()) as any)
    const body = await res.json()

    expect(body.names).toEqual({ alice: PK_ALICE, bob: PK_BOB, alias: PK_ALICE })
    expect(Object.keys(body.relays).sort()).toEqual([PK_ALICE, PK_BOB].sort())
  })

  it('returns empty maps for the reserved "_" identity without querying', async () => {
    const res = await GET(createNextRequest(url('_')) as any)
    const body = await res.json()

    expect(body).toEqual({ names: {}, relays: {} })
    expect(prismaMock.lightningAddress.findMany).not.toHaveBeenCalled()
  })

  it('sets CORS headers so browser Nostr clients can verify', async () => {
    vi.mocked(prismaMock.lightningAddress.findMany).mockResolvedValue([
      { username: 'alice', user: { pubkey: PK_ALICE } },
    ] as any)

    const res = await GET(createNextRequest(url('alice')) as any)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('answers CORS preflight (OPTIONS) with 204 + headers', async () => {
    const res = OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
  })
})
