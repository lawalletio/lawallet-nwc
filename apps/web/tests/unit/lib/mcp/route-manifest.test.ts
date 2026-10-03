import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getCatalog } from '@/lib/mcp/catalog'
import { policyFor } from '@/lib/mcp/policy'
import { routeManifest } from '@/lib/mcp/route-manifest'

// The route file behind an OpenAPI template: `{id}` → `[id]`.
const routeFile = (template: string) =>
  path.join(
    __dirname,
    '../../../..',
    'app',
    template.replace(/^\//, '').replace(/\{([^}]+)\}/g, '[$1]'),
    'route.ts'
  )

// Same export detection as scripts/docs-sync.mjs — no route module is imported.
const exportsVerb = (file: string, verb: string) =>
  new RegExp(
    `export\\s+(?:const|async\\s+function|function)\\s+${verb}\\b`
  ).test(readFileSync(file, 'utf8'))

describe('route manifest', () => {
  it('has a loader for every exposed operation, whose file exports its verb', () => {
    const missing: string[] = []
    for (const op of getCatalog()) {
      if (!('access' in policyFor(op))) continue
      const file = routeFile(op.path)
      if (
        !routeManifest[op.path] ||
        !existsSync(file) ||
        !exportsVerb(file, op.method)
      ) {
        missing.push(`${op.method} ${op.path}`)
      }
    }
    expect(missing).toEqual([])
  })

  // MCP callers only ever hold a Bearer credential. The OpenAPI document once
  // listed a NIP-98-only route as public, which made it an exposed tool that
  // could only answer 401 — so check the handlers, not just the document.
  it('exposes no operation whose handler accepts only a NIP-98 signature', () => {
    const nip98Only =
      /\b(validateAdminAuth|validateNip98Auth|validateRoleAuth|validatePermissionAuth|withAdminAuth|withRoleAuth|withPermissionAuth)\b|requireNip98:\s*true/
    const offenders = getCatalog()
      .filter(op => 'access' in policyFor(op))
      .filter(op => nip98Only.test(readFileSync(routeFile(op.path), 'utf8')))
      .map(op => op.operationId)
    expect(offenders).toEqual([])
  })

  it('points every entry at an existing route file', () => {
    for (const template of Object.keys(routeManifest)) {
      expect(existsSync(routeFile(template)), template).toBe(true)
    }
  })
})
