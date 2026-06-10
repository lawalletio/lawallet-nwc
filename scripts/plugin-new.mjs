#!/usr/bin/env node

// Scaffold a new in-codebase plugin from apps/web/plugins/_template.
//
//   pnpm plugin:new my-plugin
//
// Copies the template, substitutes placeholders, and prints the two
// registration lines to add (plugins/index.ts + plugins/client.ts) — the
// only core edits a plugin ever needs.

import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pluginsDir = path.join(root, 'apps', 'web', 'plugins')

const id = process.argv[2]

if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error('Usage: pnpm plugin:new <id>   (lowercase, digits, dashes)')
  process.exit(1)
}

const target = path.join(pluginsDir, id)
if (existsSync(target)) {
  console.error(`apps/web/plugins/${id} already exists`)
  process.exit(1)
}

const camel = id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
const display = id
  .split('-')
  .map(w => w[0].toUpperCase() + w.slice(1))
  .join(' ')

cpSync(path.join(pluginsDir, '_template'), target, { recursive: true })

for (const file of readdirSync(target)) {
  const p = path.join(target, file)
  const content = readFileSync(p, 'utf8')
    .replaceAll('__PLUGIN_ID__', id)
    .replaceAll('__PLUGIN_CAMEL__', camel)
    .replaceAll('__PLUGIN_NAME__', display)
  writeFileSync(p, content)
}

console.log(`Created apps/web/plugins/${id}/

Now register it (the only core edits):

  apps/web/plugins/index.ts
    import { ${camel}Plugin } from './${id}/plugin'
    registerPlugin(${camel}Plugin)

  apps/web/plugins/client.ts   (if it ships UI)
    import { ${camel}PluginClient } from './${id}/client'
    registerPluginClient(${camel}PluginClient)

Then enable it in /admin/plugins. Rules: docs/PLUGINS.md`)
