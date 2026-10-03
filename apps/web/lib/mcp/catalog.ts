import { getOpenApiDocument } from '@lawallet-nwc/openapi'
import type { JsonSchema } from '@/lib/mcp/types'

/**
 * Paths that are never part of the agent surface: the MCP and OAuth endpoints
 * themselves, and server-to-server or development plumbing. Mirrored by the
 * route-manifest generator in `scripts/docs-sync.mjs`.
 */
export const EXCLUDED_PATH_PREFIXES = [
  '/api/mcp',
  '/api/oauth',
  '/api/internal',
  '/api/dev',
  '/api/webhooks',
  '/api/events'
] as const

/**
 * How an operation authenticates: `public` needs nothing, `bearer` accepts a
 * session JWT, `other` only takes credentials an agent never holds (NIP-98
 * signatures, the listener HMAC, the SSE query token).
 */
export type SecurityClass = 'public' | 'bearer' | 'other'

/** One REST operation, described for tool use. */
export interface CatalogOperation {
  operationId: string
  /** Upper-case HTTP verb, as exported by the route module. */
  method: string
  /** OpenAPI path template, e.g. `/api/cards/{id}`. */
  path: string
  summary: string
  description: string
  tag: string | null
  /** `x-required-role`; null when the document omits it. */
  requiredRole: string | null
  security: SecurityClass
  pathParams: string[]
  queryParams: string[]
  /**
   * How the JSON body maps onto tool arguments: `flat` puts the body's
   * properties next to the path and query parameters, `nested` keeps it under
   * a `body` argument (non-object bodies, or a name clash with a parameter).
   */
  body: 'none' | 'flat' | 'nested'
  /** Self-contained JSON Schema for the arguments: `type: 'object'`, no `$ref`. */
  inputSchema: JsonSchema
}

type Json = Record<string, unknown>

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head']

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isExcludedPath(path: string): boolean {
  return EXCLUDED_PATH_PREFIXES.some(
    prefix => path === prefix || path.startsWith(`${prefix}/`)
  )
}

/**
 * Replaces every `#/components/...` reference with the component itself. A
 * reference that cannot be resolved, or that points back at a schema being
 * expanded, becomes `{}` (any value) — tool schemas must not carry `$ref`.
 */
function inline(node: unknown, components: Json, seen: string[]): unknown {
  if (Array.isArray(node)) return node.map(n => inline(n, components, seen))
  if (!isRecord(node)) return node

  if (typeof node.$ref === 'string') {
    const { $ref, ...siblings } = node
    const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec($ref)
    const target = match
      ? (components[match[1]] as Json | undefined)?.[match[2]]
      : undefined
    const rest = inline(siblings, components, seen) as Json
    if (target === undefined || seen.includes($ref)) return rest
    return {
      ...(inline(target, components, [...seen, $ref]) as Json),
      ...rest
    }
  }

  const out: Json = {}
  for (const [key, value] of Object.entries(node)) {
    out[key] = inline(value, components, seen)
  }
  return out
}

function securityClass(requirements: unknown): SecurityClass {
  const list = Array.isArray(requirements) ? (requirements as Json[]) : []
  // An empty requirement object means "anonymous is fine" (optional auth).
  if (list.length === 0 || list.some(r => Object.keys(r).length === 0)) {
    return 'public'
  }
  return list.some(r => 'BearerJWT' in r) ? 'bearer' : 'other'
}

function toOperation(
  path: string,
  verb: string,
  op: Json,
  doc: Json,
  components: Json
): CatalogOperation {
  const method = verb.toUpperCase()
  const properties: Json = {}
  const required: string[] = []
  const pathParams: string[] = []
  const queryParams: string[] = []

  for (const raw of (op.parameters as unknown[] | undefined) ?? []) {
    const param = inline(raw, components, []) as Json
    // Header and cookie parameters are transport details, not agent inputs.
    if (param.in !== 'path' && param.in !== 'query') continue
    const name = String(param.name)
    const schema = isRecord(param.schema) ? param.schema : {}
    properties[name] =
      typeof param.description === 'string' && !schema.description
        ? { ...schema, description: param.description }
        : schema
    if (param.in === 'path' || param.required === true) required.push(name)
    ;(param.in === 'path' ? pathParams : queryParams).push(name)
  }

  const requestBody = inline(op.requestBody, components, []) as Json | undefined
  const content = requestBody?.content as Json | undefined
  const bodySchema = (content?.['application/json'] as Json | undefined)
    ?.schema as Json | undefined

  let body: CatalogOperation['body'] = 'none'
  if (bodySchema) {
    const bodyProps = isRecord(bodySchema.properties)
      ? bodySchema.properties
      : null
    const clash =
      !bodyProps ||
      Object.keys(bodyProps).some(key => key in properties || key === 'body')
    if (bodySchema.type === 'object' && !clash) {
      body = 'flat'
      Object.assign(properties, bodyProps)
      if (Array.isArray(bodySchema.required)) {
        required.push(...(bodySchema.required as string[]))
      }
    } else {
      body = 'nested'
      properties.body = bodySchema
      required.push('body')
    }
  }

  return {
    operationId:
      typeof op.operationId === 'string' ? op.operationId : `${method} ${path}`,
    method,
    path,
    summary: typeof op.summary === 'string' ? op.summary : '',
    description: typeof op.description === 'string' ? op.description : '',
    tag:
      Array.isArray(op.tags) && typeof op.tags[0] === 'string'
        ? op.tags[0]
        : null,
    requiredRole:
      typeof op['x-required-role'] === 'string' ? op['x-required-role'] : null,
    security: securityClass(op.security ?? doc.security),
    pathParams,
    queryParams,
    body,
    inputSchema: {
      type: 'object',
      properties,
      ...(required.length ? { required } : {})
    }
  }
}

/** Turns an OpenAPI 3.1 document into the operation catalog. Pure. */
export function buildCatalog(doc: Json): CatalogOperation[] {
  const components = isRecord(doc.components) ? doc.components : {}
  const operations: CatalogOperation[] = []

  for (const [path, item] of Object.entries((doc.paths as Json) ?? {})) {
    if (isExcludedPath(path) || !isRecord(item)) continue
    for (const [verb, op] of Object.entries(item)) {
      if (!METHODS.includes(verb) || !isRecord(op)) continue
      operations.push(toOperation(path, verb, op, doc, components))
    }
  }
  return operations
}

let cached: {
  list: CatalogOperation[]
  byId: Map<string, CatalogOperation>
} | null = null

function load() {
  if (!cached) {
    const list = buildCatalog(getOpenApiDocument() as unknown as Json)
    cached = { list, byId: new Map(list.map(op => [op.operationId, op])) }
  }
  return cached
}

/** Every catalogued operation, in document order. Built once per process. */
export function getCatalog(): CatalogOperation[] {
  return load().list
}

export function findOperation(
  operationId: string
): CatalogOperation | undefined {
  return load().byId.get(operationId)
}
