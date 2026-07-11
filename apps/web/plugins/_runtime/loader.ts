import { prisma } from '@/lib/prisma'
import { getSettings, invalidateHotSettingsCache } from '@/lib/settings'
import { listPlugins, getPlugin } from './registry'
import type { LawalletPlugin, PluginState } from './types'

/**
 * Enabled-state resolution. The flag lives in the existing flat Settings
 * key/value table under `plugin.<id>.enabled` ('true' | 'false') — zero
 * schema changes for enable/disable. Absent key → the plugin's
 * `defaultEnabled` (false unless declared).
 */

const settingKey = (id: string) => `plugin.${id}.enabled`

export async function isPluginEnabled(id: string): Promise<boolean> {
  const plugin = getPlugin(id)
  if (!plugin) return false

  const settings = await getSettings([settingKey(id)])
  const stored = settings[settingKey(id)]
  if (stored === undefined) return plugin.defaultEnabled ?? false
  return stored === 'true'
}

/** All registered plugins with their resolved enabled state, one query. */
export async function listPluginStates(): Promise<PluginState[]> {
  const plugins = listPlugins()
  if (plugins.length === 0) return []

  const settings = await getSettings(plugins.map(p => settingKey(p.id)))

  return plugins.map(p => {
    const stored = settings[settingKey(p.id)]
    return {
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      enabled:
        stored === undefined ? (p.defaultEnabled ?? false) : stored === 'true'
    }
  })
}

/** Only the enabled plugins — what hook dispatch iterates. */
export async function enabledPlugins(): Promise<LawalletPlugin[]> {
  const states = await listPluginStates()
  const enabled = new Set(states.filter(s => s.enabled).map(s => s.id))
  return listPlugins().filter(p => enabled.has(p.id))
}

/**
 * Persist the enabled flag. Runs the plugin's idempotent `migrate()` on
 * enable so first activation can set up its records.
 */
export async function setPluginEnabled(
  id: string,
  enabled: boolean
): Promise<void> {
  const plugin = getPlugin(id)
  if (!plugin) throw new Error(`Unknown plugin: ${id}`)

  await prisma.settings.upsert({
    where: { name: settingKey(id) },
    update: { value: String(enabled) },
    create: { name: settingKey(id), value: String(enabled) }
  })
  invalidateHotSettingsCache()

  if (enabled && plugin.migrate) await plugin.migrate()
}
