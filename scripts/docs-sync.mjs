#!/usr/bin/env node

// Docs drift guard. Three checks, one ratchet:
//
//  1. Route ↔ OpenAPI coverage — every exported verb in
//     apps/web/app/api/**/route.ts must have a matching operation in the
//     generated OpenAPI document. Known-undocumented routes live in
//     scripts/docs-sync.allowlist.json (the ratchet: the gate only fails on
//     NEW undocumented routes; shrink the allowlist over time).
//  2. Orphaned MDX — every apps/docs/content/docs page must be reachable
//     from its section's meta.json (unless the section spreads "...").
//  3. OpenAPI snapshot — packages/openapi/openapi.snapshot.json must match
//     the generated document, so spec changes show up in PR diffs.
//
// Usage:
//   node scripts/docs-sync.mjs --check    # CI gate (exit 1 on drift)
//   node scripts/docs-sync.mjs --write    # refresh the snapshot

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const apiRoot = path.join(root, 'apps', 'web', 'app', 'api')
const docsRoot = path.join(root, 'apps', 'docs', 'content', 'docs')
const allowlistPath = path.join(root, 'scripts', 'docs-sync.allowlist.json')
const snapshotPath = path.join(root, 'packages', 'openapi', 'openapi.snapshot.json')

const write = process.argv.includes('--write')
const problems = []

// ── 1. Route ↔ OpenAPI coverage ────────────────────────────────────────────

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

function routeFileToApiPath(file) {
  const rel = path.relative(apiRoot, path.dirname(file))
  const segments = rel
    .split(path.sep)
    .filter(Boolean)
    .map(seg => {
      if (seg.startsWith('[...') || seg.startsWith('[[...')) return null // catch-all
      if (seg.startsWith('[')) return `{${seg.slice(1, -1)}}`
      return seg
    })
  if (segments.includes(null)) return null
  return `/api${segments.length ? '/' + segments.join('/') : ''}`
}

function exportedVerbs(file) {
  const src = readFileSync(file, 'utf8')
  const verbs = []
  for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const re = new RegExp(
      `export\\s+(?:const|async\\s+function|function)\\s+${verb}\\b`
    )
    if (re.test(src)) verbs.push(verb)
  }
  return verbs
}

const routeFiles = walk(apiRoot).filter(f => f.endsWith(`${path.sep}route.ts`))

const doc = JSON.parse(
  execSync('pnpm --filter @lawallet-nwc/openapi exec tsx scripts/dump.mjs', {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024
  })
)

const documented = new Set()
for (const [p, ops] of Object.entries(doc.paths ?? {})) {
  for (const method of Object.keys(ops)) {
    documented.add(`${method.toUpperCase()} ${p}`)
  }
}

const allowlist = new Set(
  existsSync(allowlistPath) ? JSON.parse(readFileSync(allowlistPath, 'utf8')) : []
)

const missing = []
for (const file of routeFiles) {
  const apiPath = routeFileToApiPath(file)
  if (!apiPath) continue // catch-alls are not representable 1:1

  for (const verb of exportedVerbs(file)) {
    const key = `${verb} ${apiPath}`
    if (!documented.has(key) && !allowlist.has(key)) missing.push(key)
  }
}

if (missing.length) {
  problems.push(
    `Routes without an OpenAPI operation (add to packages/openapi/src/paths/ ` +
      `or, temporarily, to scripts/docs-sync.allowlist.json):\n` +
      missing.map(m => `  - ${m}`).join('\n')
  )
}

// Ratchet hygiene: allowlist entries that are now documented should be removed.
const stale = [...allowlist].filter(key => documented.has(key))
if (stale.length) {
  problems.push(
    `Allowlist entries now documented — remove them from ` +
      `scripts/docs-sync.allowlist.json:\n` +
      stale.map(s => `  - ${s}`).join('\n')
  )
}

// ── 2. Orphaned MDX pages ──────────────────────────────────────────────────

function checkSection(dir) {
  const metaPath = path.join(dir, 'meta.json')
  const entries = readdirSync(dir, { withFileTypes: true })

  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    const pages = meta.pages ?? []
    if (!pages.includes('...')) {
      const listed = new Set(pages.map(p => p.replace(/^\.\.\.$/, '')))
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.mdx')) continue
        const slug = entry.name.replace(/\.mdx$/, '')
        if (!listed.has(slug)) {
          problems.push(
            `Orphaned page: ${path.relative(root, path.join(dir, entry.name))} ` +
              `is not listed in ${path.relative(root, metaPath)}`
          )
        }
      }
    }
  }

  for (const entry of entries) {
    if (entry.isDirectory()) checkSection(path.join(dir, entry.name))
  }
}

if (existsSync(docsRoot)) checkSection(docsRoot)

// ── 3. OpenAPI snapshot ────────────────────────────────────────────────────

const rendered = JSON.stringify(doc, null, 2) + '\n'

if (write) {
  writeFileSync(snapshotPath, rendered)
  console.log(`Snapshot written: ${path.relative(root, snapshotPath)}`)
} else if (!existsSync(snapshotPath)) {
  problems.push(
    'Missing packages/openapi/openapi.snapshot.json — run `pnpm docs:sync`.'
  )
} else if (readFileSync(snapshotPath, 'utf8') !== rendered) {
  problems.push(
    'OpenAPI snapshot is stale — run `pnpm docs:sync` and commit the diff.'
  )
}

// ── Report ─────────────────────────────────────────────────────────────────

if (problems.length) {
  console.error(`docs-sync: ${problems.length} problem(s)\n`)
  for (const p of problems) console.error(p + '\n')
  process.exit(1)
}

console.log(
  `docs-sync: OK (${routeFiles.length} route files, ` +
    `${documented.size} documented operations, allowlist ${allowlist.size})`
)
