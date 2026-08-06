import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nip19 } from 'nostr-tools'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

// The NIP-65 resolver hits the DB + Nostr relays; stub it so this stays a pure
// route test (its own logic is covered in tests/unit/lib/nostr/relay-list.test.ts).
vi.mock('@/lib/nostr/relay-list', () => ({
  resolveUserRelays: vi.fn().mockResolvedValue([])
}))

import { GET, OPTIONS } from '@/app/.well-known/nostr.json/route'
import { DEFAULT_NOSTR_RELAYS } from '@/lib/nostr/profile'
import { DEV_ADMIN_PUBKEY, DEV_ADMIN_USER_ID } from '@/lib/dev-identity'
import { getSettings } from '@/lib/settings'
import { resolveUserRelays } from '@/lib/nostr/relay-list'

const getSettingsMock = vi.mocked(getSettings)
const resolveUserRelaysMock = vi.mocked(resolveUserRelays)

const PK_ALICE = 'a'.repeat(64)
const PK_RECEIPT = 'b'.repeat(64)

function url(name?: string, param: 'name' | 'username' = 'name') {
  const base = 'http://localhost:3000/.well-known/nostr.json'
  return name ? `${base}?${param}=${encodeURIComponent(name)}` : base
}

function mockAddress(username = 'alice', pubkey = PK_ALICE) {
  vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
    username,
    user: {
      id: 'u1',
      pubkey,
      relays: null,
      relaysUpdatedAt: null,
      nostrIdentities: []
    }
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

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /.well-known/nostr.json', () => {
  it('resolves a single name to its pubkey and advertises relays', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      user: { pubkey: PK_ALICE }
    } as any)
    getSettingsMock.mockResolvedValue({
      relays: JSON.stringify(['wss://relay.one', 'wss://relay.two'])
    })

    const res = await GET(createNextRequest(url('Alice')) as any)
    const body = await res.json()

    expect(body.names).toEqual({ alice: PK_ALICE })
    expect(body.relays).toEqual({
      [PK_ALICE]: ['wss://relay.one', 'wss://relay.two']
    })
    // Lookups are case-insensitive and keyed by the unique username.
    expect(prismaMock.lightningAddress.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: 'alice' } })
    )
  })

  it('returns the proxy address owner account pubkey in hex', async () => {
    mockAddress('proxy', DEV_ADMIN_PUBKEY)

    const res = await GET(createNextRequest(url('proxy')) as any)
    const body = await res.json()

    expect(body.names).toEqual({ proxy: DEV_ADMIN_PUBKEY })
    expect(body.relays).toHaveProperty(DEV_ADMIN_PUBKEY)
  })

  it('prefers the account primary identity over a stale user mirror', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'proxy',
      user: {
        id: 'u1',
        pubkey: 'npub1stale-invalid',
        relays: null,
        relaysUpdatedAt: null,
        nostrIdentities: [{ pubkey: PK_ALICE }]
      }
    } as any)

    const res = await GET(createNextRequest(url('proxy')) as any)
    const body = await res.json()

    expect(body.names).toEqual({ proxy: PK_ALICE })
  })

  it('supports the legacy local admin seed without mutating auth data', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'proxy',
      user: {
        id: DEV_ADMIN_USER_ID,
        pubkey: DEV_ADMIN_USER_ID,
        relays: null,
        relaysUpdatedAt: null,
        nostrIdentities: [{ pubkey: DEV_ADMIN_USER_ID }]
      }
    } as any)

    const res = await GET(createNextRequest(url('proxy')) as any)
    const body = await res.json()

    expect(body.names).toEqual({ proxy: DEV_ADMIN_PUBKEY })
  })

  it('decodes stored npubs to lowercase hex for NIP-05', async () => {
    const npub = nip19.npubEncode(PK_ALICE)
    mockAddress('alice', npub)
    resolveUserRelaysMock.mockResolvedValue(['wss://relay.one'])

    const res = await GET(createNextRequest(url('alice')) as any)
    const body = await res.json()

    expect(body).toEqual({
      names: { alice: PK_ALICE },
      relays: { [PK_ALICE]: ['wss://relay.one'] }
    })
  })

  it('normalizes uppercase hex pubkeys to lowercase', async () => {
    mockAddress('alice', PK_ALICE.toUpperCase())

    const res = await GET(createNextRequest(url('alice')) as any)
    const body = await res.json()

    expect(body.names).toEqual({ alice: PK_ALICE })
  })

  it('does not publish malformed public keys', async () => {
    mockAddress('alice', 'npub1not-valid')

    const res = await GET(createNextRequest(url('alice')) as any)
    const body = await res.json()

    expect(body).toEqual({ names: {}, relays: {} })
    expect(resolveUserRelaysMock).not.toHaveBeenCalled()
  })

  it('prefers the user’s own relay list over the operator default', async () => {
    mockAddress('alice', PK_ALICE)
    resolveUserRelaysMock.mockResolvedValue([
      'wss://lacrypta.ar',
      'wss://nos.lol'
    ])
    getSettingsMock.mockResolvedValue({
      relays: JSON.stringify(['wss://operator.only'])
    })

    const res = await GET(createNextRequest(url('alice')) as any)
    const body = await res.json()

    expect(body.relays).toEqual({
      [PK_ALICE]: ['wss://lacrypta.ar', 'wss://nos.lol']
    })
    expect(resolveUserRelaysMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', pubkey: PK_ALICE })
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
      user: { pubkey: PK_ALICE }
    } as any)

    const res = await GET(createNextRequest(url('alice')) as any)
    const body = await res.json()

    expect(body.relays[PK_ALICE]).toEqual(DEFAULT_NOSTR_RELAYS)
  })

  it('ignores malformed relay settings and uses defaults', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      user: { pubkey: PK_ALICE }
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
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(
      null as any
    )

    const res = await GET(createNextRequest(url('nobody')) as any)
    const body = await res.json()

    expect(body).toEqual({ names: {}, relays: {} })
  })

  it('exposes the zap receipt signer as the root "_" identity', async () => {
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      receiptPubkey: PK_RECEIPT
    } as any)
    getSettingsMock.mockResolvedValue({
      relays: JSON.stringify(['wss://relay.one', 'wss://relay.two'])
    })

    const res = await GET(createNextRequest(url('_')) as any)
    const body = await res.json()

    expect(body).toEqual({
      names: { _: PK_RECEIPT },
      relays: {
        [PK_RECEIPT]: ['wss://relay.one', 'wss://relay.two']
      }
    })
    expect(prismaMock.proxyServiceConfig.findUnique).toHaveBeenCalledWith({
      where: { id: 'default' },
      select: { receiptPubkey: true }
    })
    expect(prismaMock.lightningAddress.findUnique).not.toHaveBeenCalled()
  })

  it('decodes an npub receipt signer before exposing root NIP-05', async () => {
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      receiptPubkey: nip19.npubEncode(PK_RECEIPT)
    } as any)
    getSettingsMock.mockResolvedValue({})

    const res = await GET(createNextRequest(url('_')) as any)
    const body = await res.json()

    expect(body.names).toEqual({ _: PK_RECEIPT })
    expect(body.relays).toHaveProperty(PK_RECEIPT)
  })

  it('returns empty maps for "_" when no receipt signer exists', async () => {
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue(
      null as any
    )

    const res = await GET(createNextRequest(url('_')) as any)
    const body = await res.json()

    expect(body).toEqual({ names: {}, relays: {} })
    expect(prismaMock.lightningAddress.findUnique).not.toHaveBeenCalled()
  })

  it('sets CORS headers so browser Nostr clients can verify', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      user: { pubkey: PK_ALICE }
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
