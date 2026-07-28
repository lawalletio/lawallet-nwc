import { createCipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { decryptProxyNwcUri } from '../src/proxy-vault'
import { requestProxyReconcile } from '../src/proxy-reconcile'
import type { ListenerEnv } from '../src/env'

const MAGIC = Buffer.from('LWPX01', 'utf8')
const ACTIVE_SECRET =
  'active-proxy-vault-secret-0123456789abcdef0123456789abcdef'
const OLD_SECRET = 'previous-proxy-vault-secret-0123456789abcdef0123456789abcd'
const NWC_URI =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' +
  'b'.repeat(64)

function envelope(value: string, secret: string): Buffer {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = Buffer.from(
    hkdfSync('sha256', secret, salt, 'lawallet-proxy-vault-v1', 32)
  )
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from('default:nwc'))
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(value)),
    cipher.final()
  ])
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext])
}

function env(overrides: Partial<ListenerEnv> = {}): ListenerEnv {
  return {
    LISTENER_AUTH_SECRET: 'listener-shared-secret-0123456789abcdef',
    WEB_ORIGIN: 'https://lawallet.example',
    NWC_VAULT_SECRET: ACTIVE_SECRET,
    ...overrides
  } as ListenerEnv
}

function logger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listener proxy integration', () => {
  it('decrypts the web-compatible proxy NWC envelope', () => {
    expect(
      decryptProxyNwcUri(envelope(NWC_URI, ACTIVE_SECRET), 'default', env())
    ).toBe(NWC_URI)
  })

  it('accepts a previous vault key during rotation', () => {
    expect(
      decryptProxyNwcUri(
        envelope(NWC_URI, OLD_SECRET),
        'default',
        env({ NWC_VAULT_SECRET_PREVIOUS: OLD_SECRET })
      )
    ).toBe(NWC_URI)
  })

  it('HMAC-signs the ten-minute reconciliation wakeup', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ accepted: true }))
    vi.stubGlobal('fetch', fetchMock)
    const config = env()

    await requestProxyReconcile(config, logger())

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe(
      'https://lawallet.example/api/internal/lud16-proxy/reconcile'
    )
    const headers = init.headers as Record<string, string>
    const raw = String(init.body)
    const expected = createHmac('sha256', config.LISTENER_AUTH_SECRET)
      .update(`${headers['x-lawallet-timestamp']}.${raw}`)
      .digest('hex')
    expect(headers['x-lawallet-signature']).toBe(`sha256=${expected}`)
  })
})
