import type { z } from 'zod'
import { prisma } from '@/lib/prisma'

/**
 * PluginRecord helpers — the JSON-first storage rule.
 *
 * ALL plugin state lives in the generic `PluginRecord` table
 * (`pluginId` + `kind` + `key` → `data` JSON), validated by the plugin's
 * own Zod schemas — mirroring how `RemoteWallet.config` is JSON validated
 * by each driver's `configSchema`. Plugins MUST NOT add models, columns, or
 * enum values to `schema.prisma`: that is the one seam that creates merge
 * conflicts for forks. See docs/PLUGINS.md.
 */

export async function putRecord<T>(
  pluginId: string,
  kind: string,
  key: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  data: T
): Promise<void> {
  const parsed = schema.parse(data)

  await prisma.pluginRecord.upsert({
    where: { pluginId_kind_key: { pluginId, kind, key } },
    update: { data: parsed as object },
    create: { pluginId, kind, key, data: parsed as object }
  })
}

export async function getRecord<T>(
  pluginId: string,
  kind: string,
  key: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
): Promise<T | null> {
  const row = await prisma.pluginRecord.findUnique({
    where: { pluginId_kind_key: { pluginId, kind, key } }
  })
  if (!row) return null

  const parsed = schema.safeParse(row.data)
  return parsed.success ? parsed.data : null
}

export async function listRecords<T>(
  pluginId: string,
  kind: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
): Promise<Array<{ key: string; data: T }>> {
  const rows = await prisma.pluginRecord.findMany({
    where: { pluginId, kind },
    orderBy: { createdAt: 'desc' }
  })

  return rows.flatMap(row => {
    const parsed = schema.safeParse(row.data)
    return parsed.success ? [{ key: row.key, data: parsed.data }] : []
  })
}

export async function deleteRecord(
  pluginId: string,
  kind: string,
  key: string
): Promise<void> {
  await prisma.pluginRecord.deleteMany({ where: { pluginId, kind, key } })
}
