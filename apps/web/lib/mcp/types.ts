import type { Role } from '@/lib/auth/permissions'
import type { OAuthScope } from '@/lib/oauth/constants'

/** A JSON Schema object, as carried by MCP tool definitions. */
export type JsonSchema = Record<string, unknown>

/** Who is calling the MCP endpoint — resolved once per HTTP request. */
export interface McpCaller {
  /** Null on the unauthenticated public endpoint. */
  user: {
    /** Primary pubkey of the account (hex). */
    pubkey: string
    /** Account id (`User.id`); null when the pubkey has no account yet. */
    userId: string | null
    role: Role
  } | null
  /** MCP scopes in effect. Empty for anonymous callers. */
  scopes: ReadonlySet<OAuthScope>
  /**
   * The OAuth grant behind the call. Null for anonymous callers and for
   * callers presenting a session or device JWT — those never get `spend`.
   */
  grant: {
    id: string
    clientName: string
    spendLimitSats: number | null
  } | null
  /**
   * `Authorization` header to present to REST handlers when a tool is served
   * by dispatching to one in-process. Null when anonymous.
   */
  authorization: string | null
  /** Base URL of this instance, no trailing slash. */
  apiUrl: string
  /** The inbound MCP request — source of the client-IP headers. */
  request: Request
}

/**
 * Behaviour hints shown to the user by MCP hosts. The three required ones are
 * explicit on purpose: a host treats a missing hint pessimistically (not
 * read-only, destructive, open-world), which makes every tool look like a
 * dangerous write and prompts for confirmation on plain reads.
 */
export interface McpToolAnnotations {
  /** True only when the tool cannot change anything. */
  readOnlyHint: boolean
  /** True when the tool can delete data or move funds. */
  destructiveHint: boolean
  /** True when the tool reaches beyond this instance (Lightning, other hosts). */
  openWorldHint: boolean
  idempotentHint?: boolean
}

/** Tool definition as listed by `tools/list`. */
export interface McpToolDescriptor {
  /** `^[a-z0-9_]{1,64}$` — the strictest rule among MCP hosts. */
  name: string
  title: string
  description: string
  /** JSON Schema with `type: 'object'`. */
  inputSchema: JsonSchema
  annotations: McpToolAnnotations
}

/** A tool implemented in this codebase rather than mapped to a REST operation. */
export interface NativeTool extends McpToolDescriptor {
  /**
   * Scope the caller must hold. `public` tools are also listed for anonymous
   * callers; every other scope implies an authenticated caller.
   */
  scope: OAuthScope | 'public'
  /** Returns a JSON-serializable result. Throw {@link McpToolError} to fail. */
  handler: (
    args: Record<string, unknown>,
    caller: McpCaller
  ) => Promise<unknown>
}

/**
 * A failure the model should see and can act on (bad input, budget exceeded,
 * payment rejected). Reported as an MCP tool result with `isError: true`; the
 * message must be safe to show and must not contain secrets.
 */
export class McpToolError extends Error {
  /** Optional machine-readable detail returned alongside the message. */
  public readonly data?: Record<string, unknown>

  constructor(message: string, data?: Record<string, unknown>) {
    super(message)
    this.name = 'McpToolError'
    this.data = data
  }
}
