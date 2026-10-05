import { withRequestLogging } from '@/lib/logger'
import { resolvePublicCaller } from '@/lib/mcp/caller'
import { handleMcpPost } from '@/lib/mcp/protocol'

export const maxDuration = 60

/**
 * POST /api/mcp/public — anonymous MCP endpoint serving only public tools
 * (LUD-16 lookups, instance info). Credentials are ignored, never rejected.
 */
export const POST = withRequestLogging((request: Request) =>
  handleMcpPost(request, {
    resolveCaller: resolvePublicCaller,
    cacheScope: 'public'
  })
)
