import { withRequestLogging } from '@/lib/logger'
import { resolveCaller } from '@/lib/mcp/caller'
import { handleMcpPost } from '@/lib/mcp/protocol'

// A tool call may wait on a Lightning payment.
export const maxDuration = 60

/**
 * POST /api/mcp — the authenticated MCP endpoint (OAuth protected resource).
 * Accepts an OAuth access token issued by this instance, or a session/device
 * JWT; anything else gets a 401 that starts the OAuth flow.
 */
export const POST = withRequestLogging((request: Request) =>
  handleMcpPost(request, { resolveCaller, cacheScope: 'private' })
)
