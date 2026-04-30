import { prisma } from '@/lib/prisma'

/**
 * Loads settings rows from the DB and returns them as a flat `name → value` object.
 * Always pass `keys` when only a subset is needed — an unfiltered call scans the
 * whole `Settings` table.
 *
 * @param keys - Optional whitelist of setting names to fetch.
 * @returns Object keyed by setting name; missing keys are simply absent.
 */
export async function getSettings(keys?: string[]) {
  try {
    const settings = await prisma.settings.findMany({
      where: keys ? { name: { in: keys } } : undefined
    })

    // Transform the array into a JSON object where name is the key and value is the value
    const settingsObject = settings.reduce(
      (acc, setting) => {
        acc[setting.name] = setting.value
        return acc
      },
      {} as Record<string, string>
    )

    return settingsObject
  } catch (error) {
    console.error('Error fetching settings:', error)
    throw error
  }
}
