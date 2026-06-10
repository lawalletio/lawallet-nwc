import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { listPluginStates } from '@/plugins/index'

/**
 * GET /api/plugins — registered plugins with their enabled state.
 * Any authenticated user: the sidebar uses this to decide which plugin
 * nav items to render (per-item RBAC still applies on top).
 */
export const GET = withErrorHandling(async (request: Request) => {
  await authenticate(request)
  const plugins = await listPluginStates()
  return NextResponse.json({ plugins })
})
