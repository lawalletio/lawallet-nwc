import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// getEnv() caches the parsed env, so each case re-imports the route fresh.
async function get() {
  vi.resetModules()
  const { GET } =
    await import('@/app/.well-known/apple-app-site-association/route')
  return GET()
}

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgresql://test@localhost/test')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /.well-known/apple-app-site-association', () => {
  it('404s when APPLE_APP_IDS is unset', async () => {
    vi.stubEnv('APPLE_APP_IDS', '')
    expect((await get()).status).toBe(404)
  })

  it('lists the trimmed app IDs for webcredentials and applinks', async () => {
    vi.stubEnv('APPLE_APP_IDS', ' TEAM1.io.lawallet.wallet, ,TEAM2.io.other ')
    const res = await get()
    const ids = ['TEAM1.io.lawallet.wallet', 'TEAM2.io.other']

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({
      webcredentials: { apps: ids },
      applinks: {
        details: [{ appIDs: ids, components: [{ '/': '/wallet/activate/*' }] }]
      }
    })
  })
})
