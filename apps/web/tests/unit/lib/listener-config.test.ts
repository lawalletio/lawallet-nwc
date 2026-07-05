import { describe, it, expect, vi, beforeEach } from 'vitest'

const envState = vi.hoisted(() => ({
  url: undefined as string | undefined,
  secret: undefined as string | undefined,
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    listener: {
      url: envState.url,
      secret: envState.secret,
      requestTimeoutMs: 10000,
      enabled: !!(envState.url && envState.secret),
      webhookEnabled: !!envState.secret,
    },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

import { getListenerConfig } from '@/lib/listener-config'
import { getSettings } from '@/lib/settings'

const ENV_URL = 'http://listener.env:4100'
const ENV_SECRET = 'env-secret-that-is-at-least-32-chars!!'
const DB_URL = 'https://listener.example.com'
const DB_SECRET = 'db-secret-that-is-at-least-32-chars!!!'

beforeEach(() => {
  vi.clearAllMocks()
  envState.url = undefined
  envState.secret = undefined
  vi.mocked(getSettings).mockResolvedValue({})
})

describe('getListenerConfig', () => {
  it('env-auto: enables when both env vars are present and no DB rows exist', async () => {
    envState.url = ENV_URL
    envState.secret = ENV_SECRET

    const cfg = await getListenerConfig()
    expect(cfg.enabled).toBe(true)
    expect(cfg.url).toBe(ENV_URL)
    expect(cfg.secret).toBe(ENV_SECRET)
    expect(cfg.urlSource).toBe('env')
    expect(cfg.secretSource).toBe('env')
    expect(cfg.enabledSource).toBe('env-auto')
  })

  it('stays disabled with no env and no DB config', async () => {
    const cfg = await getListenerConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.url).toBeNull()
    expect(cfg.secret).toBeNull()
    expect(cfg.enabledSource).toBe('none')
  })

  it('does NOT env-auto-enable on a partial env pair', async () => {
    envState.url = ENV_URL

    const cfg = await getListenerConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.urlSource).toBe('env')
    expect(cfg.secretSource).toBe('none')
  })

  it('DB values override env values', async () => {
    envState.url = ENV_URL
    envState.secret = ENV_SECRET
    vi.mocked(getSettings).mockResolvedValue({
      listener_enabled: 'true',
      listener_url: DB_URL,
      listener_auth_secret: DB_SECRET,
    })

    const cfg = await getListenerConfig()
    expect(cfg.enabled).toBe(true)
    expect(cfg.url).toBe(DB_URL)
    expect(cfg.secret).toBe(DB_SECRET)
    expect(cfg.urlSource).toBe('settings')
    expect(cfg.secretSource).toBe('settings')
    expect(cfg.enabledSource).toBe('settings')
  })

  it("DB 'false' force-disables even over a full env pair", async () => {
    envState.url = ENV_URL
    envState.secret = ENV_SECRET
    vi.mocked(getSettings).mockResolvedValue({ listener_enabled: 'false' })

    const cfg = await getListenerConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.enabledSource).toBe('settings')
    // Effective values still resolve — the tab shows them even while off.
    expect(cfg.url).toBe(ENV_URL)
  })

  it("DB 'true' without a resolvable url/secret stays disabled", async () => {
    vi.mocked(getSettings).mockResolvedValue({ listener_enabled: 'true' })

    const cfg = await getListenerConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.enabledSource).toBe('settings')
  })

  it("DB 'true' + DB url + env secret enables (mixed sources)", async () => {
    envState.secret = ENV_SECRET
    vi.mocked(getSettings).mockResolvedValue({
      listener_enabled: 'true',
      listener_url: DB_URL,
    })

    const cfg = await getListenerConfig()
    expect(cfg.enabled).toBe(true)
    expect(cfg.urlSource).toBe('settings')
    expect(cfg.secretSource).toBe('env')
  })

  it('treats DB empty strings as unset (falls back to env)', async () => {
    envState.url = ENV_URL
    envState.secret = ENV_SECRET
    vi.mocked(getSettings).mockResolvedValue({
      listener_url: '',
      listener_auth_secret: '',
    })

    const cfg = await getListenerConfig()
    expect(cfg.url).toBe(ENV_URL)
    expect(cfg.secret).toBe(ENV_SECRET)
    expect(cfg.urlSource).toBe('env')
    expect(cfg.secretSource).toBe('env')
  })

  it('ignores a stored secret shorter than 32 chars', async () => {
    envState.url = ENV_URL
    envState.secret = ENV_SECRET
    vi.mocked(getSettings).mockResolvedValue({
      listener_auth_secret: 'too-short',
    })

    const cfg = await getListenerConfig()
    expect(cfg.secret).toBe(ENV_SECRET)
    expect(cfg.secretSource).toBe('env')
  })

  it('falls back to env-only when the settings read fails', async () => {
    envState.url = ENV_URL
    envState.secret = ENV_SECRET
    vi.mocked(getSettings).mockRejectedValue(new Error('db down'))

    const cfg = await getListenerConfig()
    expect(cfg.enabled).toBe(true)
    expect(cfg.url).toBe(ENV_URL)
    expect(cfg.enabledSource).toBe('env-auto')
  })
})
