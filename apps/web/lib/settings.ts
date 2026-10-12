import { prisma } from '@/lib/prisma'

// Every Settings write in this process calls `invalidateHotSettingsCache()`,
// so the TTL only bounds how long OTHER instances serve a stale value.
// ponytail: process-local; a shared cache (unstable_cache + tag) if 15s
// cross-instance staleness ever matters.
const HOT_SETTINGS_TTL_MS = 15_000

type SettingsMap = Record<string, string>

interface SettingsReadOptions {
  /** Share the process-wide snapshot used by hot request paths. */
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
 * Returns the whole-table settings snapshot shared by hot request paths (auth,
 * maintenance, the public settings read, the manifest). Concurrent cache misses
 * join one DB query and successful reads stay valid for
 * {@link HOT_SETTINGS_TTL_MS}. Failed reads are never cached.
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
  const promise = loadSettings()
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
