import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { getConfig } from '../../config/index.js'
import { dashboardBus } from '../../events/bus.js'
import { dashboardHtml } from '../../dashboard/html.js'
import { AuthenticationError } from '../errors.js'

/**
 * The SSE endpoint is called from an EventSource, which cannot set custom
 * headers — so we accept the admin secret as `?token=...` in addition to the
 * standard Bearer header. Bypassed entirely when DANGEROUSLY_FREE=true.
 */
const sseAuth: MiddlewareHandler = async (c, next) => {
  const config = getConfig()
  if (config.security.dangerouslyFree) return next()

  const expected = config.http.adminSecret
  if (!expected) {
    throw new AuthenticationError('Admin token not configured')
  }

  const headerToken = (c.req.header('authorization') ?? '')
    .replace(/^bearer\s+/i, '')
    .trim()
  const queryToken = c.req.query('token') ?? ''
  const presented = headerToken || queryToken

  if (!presented || !constantTimeEqual(presented, expected)) {
    throw new AuthenticationError('Invalid admin token')
  }
  return next()
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export function dashboardRoutes(): Hono {
  const app = new Hono()

  // Dashboard HTML is public — every API call it makes is still authenticated.
  app.get('/dashboard', c =>
    c.html(dashboardHtml(), 200, {
      'Cache-Control': 'no-store'
    })
  )
  app.get('/', c => c.redirect('/dashboard'))

  app.get('/api/v1/events/stream', sseAuth, c => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (event: string, data: string) => {
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
            )
          } catch {
            // stream closed
          }
        }

        write('hello', JSON.stringify({ ts: Date.now() }))

        const unsub = dashboardBus.subscribe(event => {
          write(event.type, JSON.stringify(event))
        })

        const heartbeat = setInterval(() => {
          write('ping', String(Date.now()))
        }, 30000)

        const abort = () => {
          clearInterval(heartbeat)
          unsub()
          try {
            controller.close()
          } catch {
            // ignore
          }
        }

        c.req.raw.signal.addEventListener('abort', abort, { once: true })
      }
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
    })
  })

  // Dev-only: synthesise a notification event straight into the bus.
  // Useful for dashboard UX development without waiting for a real payment.
  app.post('/api/v1/events/test', sseAuth, async c => {
    const body = await c.req.json().catch(() => ({}))
    const type = (body as { type?: string }).type ?? 'payment_received'
    dashboardBus.emit({
      type: 'notification',
      nwcConnectionId: 'test-nwc-id',
      eventId: 'test-' + Math.random().toString(36).slice(2, 10),
      eventKind: type === 'payment_sent' ? 23196 : 23197,
      relayUrl: 'wss://test.example',
      createdAt: Math.floor(Date.now() / 1000),
      notificationType: type,
      paymentHash: 'abcd1234ef567890' + Math.random().toString(36).slice(2, 18),
      amount: 21000,
      description: 'Synthetic ' + type + ' event',
      payload: {
        notification_type: type,
        notification: {
          type: type === 'payment_sent' ? 'outgoing' : 'incoming',
          invoice: 'lnbc21n...',
          amount: 21000,
          payment_hash: 'abcd1234'
        }
      },
      ts: Date.now()
    })
    return c.json({ success: true, data: { emitted: true } })
  })

  return app
}
