import { logger } from '@/lib/logger'
import { checkMaintenance } from '@/lib/middleware/maintenance'
import { hasRole, isValidRole } from '@/lib/auth/permissions'
import { toApiError } from '@/types/server/error-handler'
import { MCP_PATH, type OAuthScope } from '@/lib/oauth/constants'
import {
  McpToolError,
  type McpCaller,
  type McpToolDescriptor,
  type NativeTool
} from '@/lib/mcp/types'
import {
  findOperation,
  getCatalog,
  type CatalogOperation
} from '@/lib/mcp/catalog'
import {
  PROMOTED_TOOLS,
  policyFor,
  type OperationAccess,
  type PromotedTool
} from '@/lib/mcp/policy'
import { dispatchOperation } from '@/lib/mcp/dispatch'
import { redactSecrets } from '@/lib/mcp/redact'
import { instanceTools } from '@/lib/mcp/instance-tools'
import { walletTools } from '@/lib/mcp/wallet-tools'

/** Longest tool-result text sent back; Claude Code caps results near 25k tokens. */
export const MAX_RESULT_CHARS = 80_000

const MAX_DESCRIPTION_CHARS = 1000

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError: boolean
}

interface Tool {
  descriptor: McpToolDescriptor
  /** Null when the caller may use the tool, else why not (shown to the model). */
  denial: (caller: McpCaller) => string | null
  run: (
    args: Record<string, unknown>,
    caller: McpCaller
  ) => Promise<{ value: unknown; isError: boolean }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function signInRequired(caller: McpCaller): string {
  return `Sign-in required: connect an MCP client to ${caller.apiUrl}${MCP_PATH} to use this.`
}

function scopeDenial(
  scope: OAuthScope | 'public',
  caller: McpCaller
): string | null {
  if (scope === 'public' || caller.scopes.has(scope)) return null
  if (!caller.user) return signInRequired(caller)
  if (scope === 'spend' && !caller.grant) {
    return 'Sending payments needs the "spend" scope, which only an OAuth connection can grant: connect this app through OAuth and enable "Send payments".'
  }
  return `This needs the "${scope}" scope. Reconnect this app and allow "${scope}" on the consent screen.`
}

function accessOf(op: CatalogOperation): OperationAccess | null {
  const policy = policyFor(op)
  return 'access' in policy ? policy.access : null
}

/**
 * Why `caller` may not invoke `op` needing `scope`, or null. REST enforces
 * RBAC and ownership again underneath; this refuses early and keeps listings
 * honest.
 */
function operationDenial(
  op: CatalogOperation,
  caller: McpCaller,
  scope: OAuthScope | 'public'
): string | null {
  const policy = policyFor(op)
  if ('excluded' in policy) {
    return `${op.operationId} is not available through MCP: ${policy.excluded}.`
  }
  if (op.security !== 'public') {
    if (!caller.user) return signInRequired(caller)
    // A protected operation without a role badge is treated as admin-only.
    const role = op.requiredRole ?? 'ADMIN'
    if (!isValidRole(role) || !hasRole(caller.user.role, role)) {
      return `${op.operationId} requires the ${role} role; this account is ${caller.user.role}.`
    }
  }
  return scopeDenial(scope, caller)
}

/** Scope a gateway call needs: `api_write` always needs `write`. */
function gatewayScope(
  op: CatalogOperation,
  access: OperationAccess
): OAuthScope | 'public' {
  if (access === 'write') return 'write'
  return op.security === 'public' ? 'public' : 'read'
}

function describe(op: CatalogOperation): string {
  const text = [op.summary, op.description].filter(Boolean).join('\n\n')
  return text.length > MAX_DESCRIPTION_CHARS
    ? `${text.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`
    : text
}

async function runOperation(
  op: CatalogOperation,
  args: Record<string, unknown>,
  caller: McpCaller
) {
  const { status, body } = await dispatchOperation(op, args, caller)
  if (status < 400) return { value: body, isError: false }
  // The body is the API's already-sanitized error envelope. `status` goes
  // last: an LNURL error body carries its own `status: "ERROR"`, which must
  // not hide the HTTP status.
  return {
    value: { ...(isRecord(body) ? body : { body }), status },
    isError: true
  }
}

// Native tools skip the REST layer, so apply its maintenance gate here. The
// internal authorization lets an admin through, exactly as on REST.
async function assertNotInMaintenance(caller: McpCaller) {
  await checkMaintenance(
    new Request(new URL(MCP_PATH, caller.request.url), {
      method: 'POST',
      headers: caller.authorization
        ? { authorization: caller.authorization }
        : undefined
    })
  )
}

function nativeTool({ scope, handler, ...descriptor }: NativeTool): Tool {
  return {
    descriptor,
    denial: caller => scopeDenial(scope, caller),
    run: async (args, caller) => {
      await assertNotInMaintenance(caller)
      return { value: await handler(args, caller), isError: false }
    }
  }
}

function promotedTool(spec: PromotedTool, op: CatalogOperation): Tool {
  const access = accessOf(op) as OperationAccess
  const scope = op.security === 'public' ? 'public' : access
  return {
    descriptor: {
      name: spec.name,
      title: spec.title,
      description: describe(op),
      inputSchema: op.inputSchema,
      annotations: {
        readOnlyHint: access === 'read',
        // None of the promoted writes deletes data or moves funds.
        destructiveHint: false,
        openWorldHint: spec.openWorld,
        idempotentHint: access === 'read'
      }
    },
    denial: caller => operationDenial(op, caller, scope),
    run: (args, caller) => runOperation(op, args, caller)
  }
}

function listOperations(args: Record<string, unknown>, caller: McpCaller) {
  const words =
    typeof args.query === 'string'
      ? args.query.toLowerCase().split(/\s+/).filter(Boolean)
      : []
  const tag = typeof args.tag === 'string' ? args.tag.toLowerCase() : null
  const limit =
    typeof args.limit === 'number' && args.limit >= 1
      ? Math.min(Math.floor(args.limit), 100)
      : 25

  const matches = getCatalog().filter(op => {
    const access = accessOf(op)
    if (!access || operationDenial(op, caller, gatewayScope(op, access))) {
      return false
    }
    if (args.access && args.access !== access) return false
    if (tag && op.tag?.toLowerCase() !== tag) return false
    const haystack = [op.operationId, op.path, op.summary, op.description]
      .concat(op.tag ?? [])
      .join(' ')
      .toLowerCase()
    return words.every(word => haystack.includes(word))
  })

  return {
    total: matches.length,
    operations: matches.slice(0, limit).map(op => {
      const access = accessOf(op) as OperationAccess
      return {
        operationId: op.operationId,
        method: op.method,
        path: op.path,
        summary: op.summary,
        tag: op.tag,
        access,
        requiredRole: op.requiredRole,
        tool: `api_${access}`,
        inputSchema: op.inputSchema
      }
    }),
    ...(caller.scopes.has('write')
      ? {}
      : {
          note: 'Write operations are hidden: this connection has no "write" scope.'
        })
  }
}

async function runGateway(
  kind: OperationAccess,
  args: Record<string, unknown>,
  caller: McpCaller
) {
  const id = args.operationId
  const op = typeof id === 'string' ? findOperation(id) : undefined
  if (!op) {
    throw new McpToolError(
      `Unknown operationId ${JSON.stringify(id)}: call api_list_operations to find one.`
    )
  }
  const access = accessOf(op)
  if (access && access !== kind) {
    throw new McpToolError(
      `${op.operationId} is a ${access} operation: call it with api_${access}.`
    )
  }
  const denial = operationDenial(op, caller, gatewayScope(op, kind))
  if (denial) throw new McpToolError(denial)
  const params = args.params ?? {}
  if (!isRecord(params)) throw new McpToolError('"params" must be an object')
  return runOperation(op, params, caller)
}

const gatewayInput = (verb: string) => ({
  type: 'object',
  properties: {
    operationId: {
      type: 'string',
      description: `operationId of a ${verb} operation, from api_list_operations.`
    },
    params: {
      type: 'object',
      description:
        'Arguments matching the operation’s inputSchema: path and query ' +
        'parameters plus body fields.'
    }
  },
  required: ['operationId']
})

const gatewayTools: Tool[] = [
  {
    descriptor: {
      name: 'api_list_operations',
      title: 'Find API operations',
      description:
        'Searches the REST operations available to this connection beyond the ' +
        'named tools. Returns each operation’s operationId, method, path, ' +
        'summary, access (read or write), the tool that calls it (api_read ' +
        'or api_write) and its inputSchema. Filter with query (words matched ' +
        'against id, path and summary), tag or access.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to match.' },
          tag: { type: 'string', description: 'OpenAPI tag, e.g. "Cards".' },
          access: { type: 'string', enum: ['read', 'write'] },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Maximum results (default 25).'
          }
        }
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true
      }
    },
    denial: () => null,
    run: async (args, caller) => ({
      value: listOperations(args, caller),
      isError: false
    })
  },
  {
    descriptor: {
      name: 'api_read',
      title: 'Call a read operation',
      description:
        'Calls a read-only REST operation of this instance by operationId ' +
        '(see api_list_operations). Nothing is changed.',
      inputSchema: gatewayInput('read'),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        // Some reads consult wallets or other hosts (LUD-16, version check).
        openWorldHint: true,
        idempotentHint: true
      }
    },
    denial: () => null,
    run: (args, caller) => runGateway('read', args, caller)
  },
  {
    descriptor: {
      name: 'api_write',
      title: 'Call a write operation',
      description:
        'Calls a REST operation that creates, changes or deletes data on this ' +
        'instance, by operationId (see api_list_operations). Operations that ' +
        'move funds are not available; payments go through wallet_pay_invoice.',
      inputSchema: gatewayInput('write'),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: false
      }
    },
    denial: caller => scopeDenial('write', caller),
    run: (args, caller) => runGateway('write', args, caller)
  }
]

let registry: Map<string, Tool> | null = null

function tools(): Map<string, Tool> {
  if (!registry) {
    const promoted = PROMOTED_TOOLS.flatMap(spec => {
      const op = findOperation(spec.operationId)
      // A promoted operation that disappeared or got excluded is not offered.
      return op && accessOf(op) ? [promotedTool(spec, op)] : []
    })
    registry = new Map(
      [
        ...instanceTools.map(nativeTool),
        ...promoted,
        ...walletTools.map(nativeTool),
        ...gatewayTools
      ].map(tool => [tool.descriptor.name, tool])
    )
  }
  return registry
}

/** The tools this caller may use, in a stable order. */
export function listTools(caller: McpCaller): McpToolDescriptor[] {
  return [...tools().values()]
    .filter(tool => tool.denial(caller) === null)
    .map(tool => tool.descriptor)
}

/** Every tool name, whether or not a given caller may use it. */
export function hasTool(name: string): boolean {
  return tools().has(name)
}

const TRUNCATION_NOTE =
  `\n[truncated: the result was longer than ${MAX_RESULT_CHARS} characters. ` +
  'Narrow it with filters or pagination parameters (limit, cursor, status…) ' +
  'and call again.]'

function toResult(value: unknown, isError: boolean): ToolResult {
  let text =
    JSON.stringify(redactSecrets(value), (_key, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ) ?? 'null'
  if (text.length > MAX_RESULT_CHARS) {
    text = text.slice(0, MAX_RESULT_CHARS) + TRUNCATION_NOTE
  }
  return { content: [{ type: 'text', text }], isError }
}

function errorValue(error: unknown): unknown {
  // `data` rides along at the top level: wallet tools put the spend budget there.
  if (error instanceof McpToolError)
    return { error: error.message, ...error.data }
  // Same sanitization as the REST error envelope: internals never leak.
  const apiError = toApiError(error)
  if (apiError.statusCode >= 500) {
    logger.error({ err: error }, 'mcp.tool_failed')
  }
  return {
    status: apiError.statusCode,
    error: { message: apiError.message, code: apiError.code }
  }
}

/**
 * Runs tool `name` for `caller`. Every failure — a missing scope, a REST
 * error, a thrown exception — comes back as an `isError` result the model can
 * act on; only an unknown tool name is a protocol error (check {@link hasTool}
 * first). Arguments are never logged: they may hold an NWC connection string.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  caller: McpCaller
): Promise<ToolResult> {
  const tool = tools().get(name)
  const started = Date.now()
  let outcome = 'ok'
  try {
    const denial = tool ? tool.denial(caller) : `Unknown tool: ${name}`
    if (denial || !tool) {
      outcome = 'denied'
      return toResult({ error: denial }, true)
    }
    const { value, isError } = await tool.run(args, caller)
    if (isError) outcome = 'error'
    return toResult(value, isError)
  } catch (error) {
    outcome = 'error'
    return toResult(errorValue(error), true)
  } finally {
    logger.info(
      {
        tool: name,
        pubkey: caller.user ? `${caller.user.pubkey.slice(0, 8)}…` : null,
        client: caller.grant?.clientName ?? null,
        outcome,
        durationMs: Date.now() - started
      },
      'mcp.tool_call'
    )
  }
}
