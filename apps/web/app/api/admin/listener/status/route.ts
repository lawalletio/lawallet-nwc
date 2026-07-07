import { NextResponse } from 'next/server'
import { getListenerConfig } from '@/lib/listener-config'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  listenerStatusResponseSchema,
  type ListenerStatusProxyResponse,
} from '@/lib/validation/schemas'

/**
 * Server-side proxy for the NWC listener's `GET /status` — the browser never
 * sees the listener URL or the shared secret. Deliberately never throws for
 * listener-side problems: the admin page renders informative states from the
 * `disabled` / `unreachable` shapes, and a 5xx here would just spam the
 * activity log via the error handler.
 */
export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.SETTINGS_READ)

  const listener = await getListenerConfig()
  if (!listener.enabled || !listener.url) {
    return NextResponse.json({
      state: 'disabled',
    } satisfies ListenerStatusProxyResponse)
  }

  try {
    const res = await fetch(new URL('/status', listener.url), {
      headers: { authorization: `Bearer ${listener.secret}` },
      // Generous: the listener's /status runs a DB query for the events feed,
      // which on a resource-constrained host (Umbrel/Start9) can take a few
      // seconds. A tight timeout here would intermittently report a healthy
      // listener as 'unreachable' and blank the dashboard.
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (!res.ok) {
      return NextResponse.json({
        state: 'unreachable',
        error: `Listener responded HTTP ${res.status}`,
      } satisfies ListenerStatusProxyResponse)
    }
    const parsed = listenerStatusResponseSchema.safeParse(await res.json())
    if (!parsed.success) {
      return NextResponse.json({
        state: 'unreachable',
        error: 'Listener returned a malformed status payload',
      } satisfies ListenerStatusProxyResponse)
    }
    return NextResponse.json({
      state: 'ok',
      status: parsed.data,
    } satisfies ListenerStatusProxyResponse)
  } catch (err) {
    return NextResponse.json({
      state: 'unreachable',
      error: err instanceof Error ? err.message : 'Listener unreachable',
    } satisfies ListenerStatusProxyResponse)
  }
})
