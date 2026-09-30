import { describe, it, expect } from 'vitest'
import {
  findOperation,
  getCatalog,
  type CatalogOperation
} from '@/lib/mcp/catalog'
import {
  OPERATION_POLICY,
  PROMOTED_TOOLS,
  policyFor,
  structuralExclusion
} from '@/lib/mcp/policy'
import { isValidRole } from '@/lib/auth/permissions'

const catalog = getCatalog()
const exposed = catalog.filter(op => 'access' in policyFor(op))
const accessOf = (op: CatalogOperation) => {
  const policy = policyFor(op)
  return 'access' in policy ? policy.access : null
}

const fakeOp = (over: Partial<CatalogOperation>): CatalogOperation => ({
  operationId: 'x.y',
  method: 'GET',
  path: '/api/x',
  summary: '',
  description: '',
  tag: null,
  requiredRole: 'USER',
  security: 'bearer',
  pathParams: [],
  queryParams: [],
  body: 'none',
  inputSchema: { type: 'object', properties: {} },
  ...over
})

describe('exposure policy vs the live OpenAPI document', () => {
  it('classifies every operation on purpose', () => {
    const unclassified = catalog
      .filter(
        op => !structuralExclusion(op) && !(op.operationId in OPERATION_POLICY)
      )
      .map(op => `${op.method} ${op.path} (${op.operationId})`)
    // A new endpoint must be added to OPERATION_POLICY in lib/mcp/policy.ts
    // as read, write or excluded — never exposed by default.
    expect(unclassified).toEqual([])
  })

  it('names no operation that no longer exists or is excluded by shape', () => {
    const live = new Map(catalog.map(op => [op.operationId, op]))
    const stale = Object.keys(OPERATION_POLICY).filter(id => {
      const op = live.get(id)
      return !op || structuralExclusion(op) !== null
    })
    expect(stale).toEqual([])
  })

  it('gives every exclusion a one-line reason', () => {
    for (const [id, policy] of Object.entries(OPERATION_POLICY)) {
      if ('excluded' in policy) {
        expect(policy.excluded, id).toMatch(/^\S.{10,200}$/)
      }
    }
  })

  it('only exposes Bearer or public operations with a known role', () => {
    for (const op of exposed) {
      expect(['bearer', 'public'], op.operationId).toContain(op.security)
      expect(
        op.requiredRole === 'PUBLIC' || isValidRole(op.requiredRole ?? ''),
        op.operationId
      ).toBe(true)
    }
  })

  it('reads with GET and writes with everything else, with named exceptions', () => {
    const readPosts = exposed
      .filter(op => op.method !== 'GET' && accessOf(op) === 'read')
      .map(op => op.operationId)
      .sort()
    expect(readPosts).toEqual([
      'nostr.profiles.resolve',
      'wallet.addresses.probeAlias'
    ])
    const writeGets = exposed
      .filter(op => op.method === 'GET' && accessOf(op) === 'write')
      .map(op => op.operationId)
    expect(writeGets).toEqual(['lud16.callback'])
  })

  it('keeps every operation that moves or reroutes funds out of reach', () => {
    for (const id of [
      'cards.emulateTap',
      'cards.scan.callback',
      'wallet.addresses.proxyBalance.forward',
      'wallet.addresses.invoices.forwarding.recover',
      'wallet.addresses.update',
      'remoteWallets.create',
      'remoteWallets.receiveAction.configure',
      'remoteWallets.receiveAction.toggle',
      'remoteWallets.receiveAction.force',
      'remoteWallets.forwardingReceipts.retry',
      'lud16Proxy.config.update',
      'lud16Proxy.config.test',
      'lud16Proxy.payments.retry',
      'settings.update',
      'users.role.set',
      'wallet.vouchers.send'
    ]) {
      const op = findOperation(id)
      expect(op, id).toBeDefined()
      expect(policyFor(op!), id).toHaveProperty('excluded')
    }
  })

  it('promotes only exposed operations under valid, unique names', () => {
    const names = PROMOTED_TOOLS.map(tool => tool.name)
    expect(new Set(names).size).toBe(names.length)
    for (const tool of PROMOTED_TOOLS) {
      expect(tool.name).toMatch(/^[a-z0-9_]{1,64}$/)
      const op = findOperation(tool.operationId)
      expect(op, tool.operationId).toBeDefined()
      expect(policyFor(op!), tool.operationId).toHaveProperty('access')
    }
  })
})

describe('structural rules', () => {
  it('excludes CORS preflights and non-Bearer credentials', () => {
    expect(structuralExclusion(fakeOp({ method: 'OPTIONS' }))).toMatch(/CORS/)
    expect(structuralExclusion(fakeOp({ security: 'other' }))).toMatch(/NIP-98/)
    expect(structuralExclusion(fakeOp({}))).toBeNull()
  })

  it('refuses an operation the table does not know (fail closed)', () => {
    expect(policyFor(fakeOp({ operationId: 'brand.new' }))).toEqual({
      excluded: 'not classified for MCP yet'
    })
    expect(policyFor(fakeOp({ method: 'OPTIONS' }))).toHaveProperty('excluded')
  })
})
