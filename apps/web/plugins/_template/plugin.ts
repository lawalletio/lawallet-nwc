import { z } from 'zod'
import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth/unified-auth'
import { NotFoundError } from '@/types/server/errors'
import { listRecords } from '../_runtime/records'
import type { LawalletPlugin } from '../_runtime/types'

/**
 * Plugin scaffold — copy this directory (scripts/plugin-new.mjs does it for
 * you), rename __PLUGIN_ID__, then register in plugins/index.ts and (if it
 * ships UI) plugins/client.ts. Rules in docs/PLUGINS.md — most importantly:
 * ALL state goes through PluginRecord (records.ts), never new schema.
 */

const configSchema = z.object({}).strict()

const itemSchema = z.object({
  label: z.string()
})

export const __PLUGIN_CAMEL__Plugin: LawalletPlugin<
  z.infer<typeof configSchema>
> = {
  id: '__PLUGIN_ID__',
  name: '__PLUGIN_NAME__',
  version: '0.1.0',
  description: 'Describe what this plugin does',
  configSchema,
  defaultEnabled: false,

  async routes(request, { method, path }) {
    if (path[0] === 'items' && method === 'GET') {
      await authenticate(request)
      const items = await listRecords('__PLUGIN_ID__', 'item', itemSchema)
      return NextResponse.json({ items: items.map(i => i.data) })
    }

    throw new NotFoundError('Unknown __PLUGIN_ID__ endpoint')
  }
}
