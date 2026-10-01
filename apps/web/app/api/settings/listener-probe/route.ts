import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { ValidationError } from '@/types/server/errors'
import { authenticateSettingsWriteRequest } from '@/lib/settings-auth'
import { getListenerConfig } from '@/lib/listener-config'
import {
  listenerProbeRequestSchema,
  listenerStatusResponseSchema,
  type ListenerProbeResponse
} from '@/lib/validation/schemas'
import { validateBody } from '@/lib/validation/middleware'

/**
 * "Test connection" for the Settings → NWC Services tab — mirror of
 * `settings/domain-probe`. Probes the listener's authenticated `GET /status`
 * with the candidate URL/secret from the form. Always 200 with an ok/error
 * shape — probe outcomes are results, not server errors.
 *
 * Secret omitted → the resolved stored/env secret, so an env-provisioned
 * pairing can be tested without re-typing it — but only when the probed URL
 * is the configured listener. That secret also signs `payment_received`
 * webhooks unless a dedicated request secret is set, so sending it to
 * whatever URL the caller names would hand it to any server they point at.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  await authenticateSettingsWriteRequest(request)

  const body = await validateBody(request, listenerProbeRequestSchema)

  let url: URL
  try {
    url = new URL('/status', body.url.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('bad protocol')
    }
  } catch {
    throw new ValidationError('Listener URL must be a valid http(s) URL')
  }

  let secret = body.secret
  if (!secret) {
    const stored = await getListenerConfig()
    if (stored.secret && !isSameOrigin(stored.url, url)) {
      return NextResponse.json({
        ok: false,
        code: 'no_secret',
        error:
          'The stored secret is only sent to the configured listener URL — save this URL first, or enter the secret to test it'
      } satisfies ListenerProbeResponse)
    }
    secret = stored.secret ?? undefined
  }
  if (!secret) {
    return NextResponse.json({
      ok: false,
      code: 'no_secret',
      error:
        'No shared secret available — enter one or set LISTENER_AUTH_SECRET'
    } satisfies ListenerProbeResponse)
  }

  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store'
    })
    if (res.status === 401) {
      return NextResponse.json({
        ok: false,
        code: 'unauthorized',
        error:
          'Listener rejected the shared secret — make sure both sides use the same LISTENER_AUTH_SECRET'
      } satisfies ListenerProbeResponse)
    }
    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        code: 'unreachable',
        error: `Listener responded HTTP ${res.status}`
      } satisfies ListenerProbeResponse)
    }
    const parsed = listenerStatusResponseSchema.safeParse(await res.json())
    if (!parsed.success) {
      return NextResponse.json({
        ok: false,
        code: 'invalid_response',
        error: 'The URL answered, but not with a listener status payload'
      } satisfies ListenerProbeResponse)
    }
    return NextResponse.json({
      ok: true,
      uptimeSeconds: parsed.data.uptimeSeconds,
      connections: parsed.data.connections.length,
      relays: parsed.data.relays.length
    } satisfies ListenerProbeResponse)
  } catch (err) {
    return NextResponse.json({
      ok: false,
      code: 'unreachable',
      error: err instanceof Error ? err.message : 'Listener unreachable'
    } satisfies ListenerProbeResponse)
  }
})

function isSameOrigin(configured: string | null, probed: URL): boolean {
  try {
    return !!configured && new URL(configured).origin === probed.origin
  } catch {
    return false
  }
}
