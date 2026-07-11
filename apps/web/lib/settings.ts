import { prisma } from '@/lib/prisma'

const HOT_SETTINGS_TTL_MS = 1000

const HOT_SETTING_KEYS = [
  'maintenance_enabled',
  'root',
  'domain',
  'endpoint',
  'subdomain',
  'listener_enabled',
  'listener_url',
  'listener_auth_secret'
] as const

type SettingsMap = Record<string, string>

interface SettingsReadOptions {
  /** Share the one-second snapshot used by latency-sensitive request paths. */
  cache?: 'hot'
}

interface HotSettingsSnapshot {
  expiresAt: number
  values: SettingsMap
}

let hotSettingsSnapshot: HotSettingsSnapshot | null = null
let hotSettingsRead: Promise<SettingsMap> | null = null
let hotSettingsGeneration = 0

async function loadSettings(keys?: readonly string[]): Promise<SettingsMap> {
  const settings =
    (await prisma.settings.findMany({
      where: keys ? { name: { in: [...keys] } } : undefined
    })) ?? []

  return settings.reduce((acc, setting) => {
    acc[setting.name] = setting.value
    return acc
  }, {} as SettingsMap)
}

/**
 * Loads settings rows from the DB and returns them as a flat `name → value` object.
 * Always pass `keys` when only a subset is needed — an unfiltered call scans the
 * whole `Settings` table.
 *
 * @param keys - Optional whitelist of setting names to fetch.
 * @param options - Use the shared hot snapshot on latency-sensitive paths.
 * @returns Object keyed by setting name; missing keys are simply absent.
 */
export async function getSettings(
  keys?: string[],
  options?: SettingsReadOptions
): Promise<SettingsMap> {
  try {
    if (options?.cache === 'hot') {
      const settings = await getHotSettings()
      if (!keys) return settings

      return keys.reduce((acc, key) => {
        if (settings[key] !== undefined) {
          acc[key] = settings[key]
        }
        return acc
      }, {} as SettingsMap)
    }

    return await loadSettings(keys)
  } catch (error) {
    console.error('Error fetching settings:', error)
    throw error
  }
}

/**
 * Returns the small settings snapshot shared by latency-sensitive request
 * paths. Concurrent cache misses join one DB query and successful reads remain
 * valid for one second. Failed reads are never cached.
 */
function getHotSettings(): Promise<SettingsMap> {
  const now = Date.now()
  if (hotSettingsSnapshot && hotSettingsSnapshot.expiresAt > now) {
    return Promise.resolve(hotSettingsSnapshot.values)
  }

  if (hotSettingsRead) {
    return hotSettingsRead
  }

  const generation = hotSettingsGeneration
  const promise = loadSettings(HOT_SETTING_KEYS)
    .then(values => {
      if (generation === hotSettingsGeneration) {
        hotSettingsSnapshot = {
          expiresAt: Date.now() + HOT_SETTINGS_TTL_MS,
          values
        }
      }
      return values
    })
    .finally(() => {
      if (hotSettingsRead === promise) {
        hotSettingsRead = null
      }
    })

  hotSettingsRead = promise
  return promise
}

/**
 * Invalidates the process-local hot snapshot after a Settings write. The
 * generation also prevents an older in-flight read from restoring stale data.
 */
export function invalidateHotSettingsCache(): void {
  hotSettingsGeneration += 1
  hotSettingsSnapshot = null
  hotSettingsRead = null
}
