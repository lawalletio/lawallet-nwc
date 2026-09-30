import { NextRequest } from 'next/server'
import { getCurrentReqId } from '@/lib/logger'
import { handleApiError } from '@/types/server/error-handler'
import { routeManifest } from '@/lib/mcp/route-manifest'
import { McpToolError, type McpCaller } from '@/lib/mcp/types'
import type { CatalogOperation } from '@/lib/mcp/catalog'

/** What a REST handler answered: its status and parsed body. */
export interface DispatchResult {
  status: number
  body: unknown
}

/**
 * Inbound headers REST handlers depend on: in-memory rate limits key on the
 * client IP headers, and public URLs are built from `host`. `x-forwarded-*`
 * is copied wholesale.
 */
const FORWARDED_HEADERS = [
  'host',
  'x-real-ip',
  'cf-connecting-ip',
  'user-agent'
]

type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>

/**
 * Serves an operation by calling its real route handler in-process, so
 * validation, RBAC, ownership checks, rate limits, maintenance mode and
 * activity logging are exactly the REST ones.
 *
 * @throws {McpToolError} When the arguments cannot form a request.
 */
export async function dispatchOperation(
  op: CatalogOperation,
  args: Record<string, unknown>,
  caller: McpCaller
): Promise<DispatchResult> {
  const known = new Set([...op.pathParams, ...op.queryParams])
  if (op.body === 'nested') known.add('body')
  const unknown =
    op.body === 'flat' ? [] : Object.keys(args).filter(key => !known.has(key))
  if (unknown.length) {
    throw new McpToolError(`Unknown argument(s): ${unknown.join(', ')}`)
  }

  const params: Record<string, string> = {}
  let path = op.path
  for (const name of op.pathParams) {
    const raw = args[name]
    const value =
      typeof raw === 'string' || (typeof raw === 'number' && isFinite(raw))
        ? String(raw)
        : null
    // Each value fills exactly its own segment: encodeURIComponent escapes
    // `/ ? #`, and dot segments are refused because URL parsing would resolve
    // them into a different route.
    if (value === null || value === '' || value === '.' || value === '..') {
      throw new McpToolError(`"${name}" must be a non-empty path segment`)
    }
    params[name] = value
    path = path.replace(`{${name}}`, () => encodeURIComponent(value))
  }

  const url = new URL(path, caller.request.url)
  if (url.pathname !== path) {
    throw new McpToolError('Path parameters must not change the route')
  }
  for (const name of op.queryParams) {
    const value = args[name]
    if (value === undefined || value === null) continue
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'object' && item !== null) {
        throw new McpToolError(`"${name}" must be a string, number or boolean`)
      }
      url.searchParams.append(name, String(item))
    }
  }

  const body =
    op.body === 'flat'
      ? Object.fromEntries(
          Object.entries(args).filter(([key]) => !known.has(key))
        )
      : op.body === 'nested'
        ? args.body
        : undefined

  const headers = new Headers()
  caller.request.headers.forEach((value, name) => {
    if (FORWARDED_HEADERS.includes(name) || name.startsWith('x-forwarded-')) {
      headers.set(name, value)
    }
  })
  if (caller.authorization) headers.set('authorization', caller.authorization)
  const reqId = getCurrentReqId()
  if (reqId) headers.set('x-request-id', reqId)
  if (body !== undefined) headers.set('content-type', 'application/json')

  const request = new NextRequest(url, {
    method: op.method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })

  const load = routeManifest[op.path]
  const handler = load ? (await load())[op.method] : undefined
  if (typeof handler !== 'function') {
    // The manifest is generated from the route files; a miss means it is stale.
    throw new Error(`No ${op.method} handler for ${op.path}`)
  }

  let response: Response
  try {
    response = await (handler as RouteHandler)(request, {
      params: Promise.resolve(params)
    })
  } catch (error) {
    // Most handlers catch their own errors (withErrorHandling); this keeps the
    // same sanitized envelope for the few that don't.
    response = handleApiError(error, undefined, request)
  }

  const text = await response.text()
  let parsed: unknown = text || null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // Not JSON: hand the text over as-is.
  }
  return { status: response.status, body: parsed }
}
