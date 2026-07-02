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
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      user: { pubkey: PK_ALICE },
    } as any)
    getSettingsMock.mockResolvedValue({
      relays: JSON.stringify(['wss://relay.one', 'wss://relay.two']),
    })

    const res = await GET(createNextRequest(url('Alice')) as any)
    const body = await res.json()

    expect(body.names).toEqual({ alice: PK_ALICE })
    expect(body.relays).toEqual({
      [PK_ALICE]: ['wss://relay.one', 'wss://relay.two'],
    })
    // Lookups are case-insensitive and keyed by the unique username.
    expect(prismaMock.lightningAddress.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: 'alice' } }),
    )
  })

  it('falls back to default relays when the operator has none configured', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      user: { pubkey: PK_ALICE },
    } as any)

    const res = await GET(createNextRequest(url('alice')) as any)
    const body = await res.json()

    expect(body.relays[PK_ALICE]).toEqual(DEFAULT_NOSTR_RELAYS)
  })

  it('ignores malformed relay settings and uses defaults', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      user: { pubkey: PK_ALICE },
    } as any)
    getSettingsMock.mockResolvedValue({ relays: 'not-json' })

    const res = await GET(createNextRequest(url('alice')) as any)
    const body = await res.json()

    expect(body.relays[PK_ALICE]).toEqual(DEFAULT_NOSTR_RELAYS)
  })

  it('requires a name — a bare request returns empty maps without querying', async () => {
    const res = await GET(createNextRequest(url()) as any)
    const body = await res.json()

    expect(body).toEqual({ names: {}, relays: {} })
    // No enumeration of registered users.
    expect(prismaMock.lightningAddress.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.lightningAddress.findMany).not.toHaveBeenCalled()
  })

  it('returns empty maps for an unknown name', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null as any)

    const res = await GET(createNextRequest(url('nobody')) as any)
    const body = await res.json()

    expect(body).toEqual({ names: {}, relays: {} })
  })

  it('returns empty maps for the reserved "_" identity without querying', async () => {
    const res = await GET(createNextRequest(url('_')) as any)
    const body = await res.json()

    expect(body).toEqual({ names: {}, relays: {} })
    expect(prismaMock.lightningAddress.findUnique).not.toHaveBeenCalled()
  })

  it('sets CORS headers so browser Nostr clients can verify', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      user: { pubkey: PK_ALICE },
    } as any)

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
