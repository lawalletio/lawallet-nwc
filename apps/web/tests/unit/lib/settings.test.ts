import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { getSettings, invalidateHotSettingsCache } from '@/lib/settings'

const rows = [
  { name: 'maintenance_enabled', value: 'false' },
  { name: 'endpoint', value: 'https://wallet.example.com' }
]

beforeEach(() => {
  resetPrismaMock()
  invalidateHotSettingsCache()
  vi.useRealTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('hot settings cache', () => {
  it('single-flights concurrent consumers and projects their requested keys', async () => {
    let resolveRead!: (value: typeof rows) => void
    const read = new Promise<typeof rows>(resolve => {
      resolveRead = resolve
    })
    vi.mocked(prismaMock.settings.findMany).mockReturnValue(read as any)

    const maintenance = getSettings(['maintenance_enabled'], { cache: 'hot' })
    const endpoint = getSettings(['endpoint'], { cache: 'hot' })

    expect(prismaMock.settings.findMany).toHaveBeenCalledOnce()
    resolveRead(rows)

    await expect(maintenance).resolves.toEqual({ maintenance_enabled: 'false' })
    await expect(endpoint).resolves.toEqual({
      endpoint: 'https://wallet.example.com'
    })
    expect(prismaMock.settings.findMany).toHaveBeenCalledWith({
      where: {
        name: {
          in: expect.arrayContaining([
            'maintenance_enabled',
            'root',
            'endpoint',
            'listener_enabled',
            'listener_url',
            'listener_auth_secret'
          ])
        }
      }
    })
  })

  it('reuses a successful read for one second and refreshes after expiry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    vi.mocked(prismaMock.settings.findMany).mockResolvedValue(rows as any)

    await getSettings(['endpoint'], { cache: 'hot' })
    await getSettings(['maintenance_enabled'], { cache: 'hot' })
    expect(prismaMock.settings.findMany).toHaveBeenCalledOnce()

    vi.setSystemTime(2001)
    await getSettings(['endpoint'], { cache: 'hot' })
    expect(prismaMock.settings.findMany).toHaveBeenCalledTimes(2)
  })

  it('does not let an invalidated in-flight read restore stale values', async () => {
    const staleRows = [{ name: 'endpoint', value: 'https://old.example.com' }]
    const freshRows = [{ name: 'endpoint', value: 'https://new.example.com' }]
    let resolveStale!: (value: typeof staleRows) => void
    const staleRead = new Promise<typeof staleRows>(resolve => {
      resolveStale = resolve
    })
    vi.mocked(prismaMock.settings.findMany)
      .mockReturnValueOnce(staleRead as any)
      .mockResolvedValueOnce(freshRows as any)

    const beforeSave = getSettings(['endpoint'], { cache: 'hot' })
    invalidateHotSettingsCache()
    await expect(getSettings(['endpoint'], { cache: 'hot' })).resolves.toEqual({
      endpoint: 'https://new.example.com'
    })

    resolveStale(staleRows)
    await expect(beforeSave).resolves.toEqual({
      endpoint: 'https://old.example.com'
    })
    await expect(getSettings(['endpoint'], { cache: 'hot' })).resolves.toEqual({
      endpoint: 'https://new.example.com'
    })
    expect(prismaMock.settings.findMany).toHaveBeenCalledTimes(2)
  })

  it('does not cache failed reads', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(prismaMock.settings.findMany)
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(rows as any)

    await expect(getSettings(['endpoint'], { cache: 'hot' })).rejects.toThrow(
      'database unavailable'
    )
    await expect(getSettings(['endpoint'], { cache: 'hot' })).resolves.toEqual({
      endpoint: 'https://wallet.example.com'
    })
    expect(prismaMock.settings.findMany).toHaveBeenCalledTimes(2)
  })
})
