import { NextRequest } from 'next/server'
import { verifyJwtToken } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import { getRolePermissions, isValidRole } from '@/lib/auth/permissions'
import { eventBus } from '@/lib/events/event-bus'

export const dynamic = 'force-dynamic'

const HEARTBEAT_INTERVAL = 30_000 // 30 seconds

export async function GET(request: NextRequest) {
  // Extract token from query params (EventSource can't send headers)
  const token = request.nextUrl.searchParams.get('token')
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing token parameter' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Verify JWT
  const config = getConfig()
  if (!config.jwt.secret) {
    return new Response(JSON.stringify({ error: 'JWT not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let payload
  try {
    const result = verifyJwtToken(token, config.jwt.secret, {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users',
    })
    payload = result.payload
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Resolve permissions from role
  const role = payload.role as string
  const permissions = isValidRole(role) ? getRolePermissions(role) : []

  // Create SSE stream
  const clientId = crypto.randomUUID()
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    start(controller) {
      // Register client in event bus
      eventBus.addClient({
        id: clientId,
        controller,
        permissions,
        connectedAt: Date.now(),
      })

      // Send connected event
      const encoder = new TextEncoder()
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`)
      )

      // Heartbeat to keep connection alive and detect dead clients
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`
            )
          )
        } catch {
          // Controller closed — clean up
          if (heartbeatTimer) clearInterval(heartbeatTimer)
          eventBus.removeClient(clientId)
        }
      }, HEARTBEAT_INTERVAL)
    },

    cancel() {
      // Client disconnected
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      eventBus.removeClient(clientId)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx proxy support
    },
  })
}
