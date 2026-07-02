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

// The NIP-65 resolver hits the DB + Nostr relays; stub it so this stays a pure
// route test (its own logic is covered in tests/unit/lib/nostr/relay-list.test.ts).
vi.mock('@/lib/nostr/relay-list', () => ({
  resolveUserRelays: vi.fn().mockResolvedValue([]),
}))

import { GET, OPTIONS } from '@/app/.well-known/nostr.json/route'
import { DEFAULT_NOSTR_RELAYS } from '@/lib/nostr/profile'
import { getSettings } from '@/lib/settings'
import { resolveUserRelays } from '@/lib/nostr/relay-list'

const getSettingsMock = vi.mocked(getSettings)
const resolveUserRelaysMock = vi.mocked(resolveUserRelays)

const PK_ALICE = 'a'.repeat(64)

function url(name?: string, param: 'name' | 'username' = 'name') {
  const base = 'http://localhost:3000/.well-known/nostr.json'
  return name ? `${base}?${param}=${encodeURIComponent(name)}` : base
}

function mockAddress(username = 'alice', pubkey = PK_ALICE) {
  vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
    username,
    user: { id: 'u1', pubkey, relays: null, relaysUpdatedAt: null },
  } as any)
}

beforeEach(() => {
  resetPrismaMock()
  getSettingsMock.mockReset()
  getSettingsMock.mockResolvedValue({})
  // Default: user has no relays → route falls back to the operator list.
  resolveUserRelaysMock.mockReset()
  resolveUserRelaysMock.mockResolvedValue([])
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

  it('prefers the user’s own relay list over the operator default', async () => {
    mockAddress('alice', PK_ALICE)
    resolveUserRelaysMock.mockResolvedValue(['wss://lacrypta.ar', 'wss://nos.lol'])
    getSettingsMock.mockResolvedValue({ relays: JSON.stringify(['wss://operator.only']) })

    const res = await GET(createNextRequest(url('alice')) as any)
    const body = await res.json()

    expect(body.relays).toEqual({ [PK_ALICE]: ['wss://lacrypta.ar', 'wss://nos.lol'] })
    expect(resolveUserRelaysMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', pubkey: PK_ALICE }),
    )
  })

  it('accepts ?username= as an alias for ?name=', async () => {
    mockAddress('alice', PK_ALICE)
    resolveUserRelaysMock.mockResolvedValue(['wss://lacrypta.ar'])

    const res = await GET(createNextRequest(url('alice', 'username')) as any)
    const body = await res.json()

    expect(body.names).toEqual({ alice: PK_ALICE })
    expect(body.relays).toEqual({ [PK_ALICE]: ['wss://lacrypta.ar'] })
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
