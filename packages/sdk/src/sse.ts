/**
 * Server-Sent Events subscription for `GET /api/events`.
 *
 * Events are change notifications (`{ type, timestamp }`) — refetch the
 * matching resource when one arrives. Authentication travels in `?token=`
 * because EventSource cannot send headers; the SDK signs a fresh NIP-98
 * event on every (re)connect.
 */

export const ALL_SSE_EVENT_TYPES = [
  'addresses:updated',
  'cards:updated',
  'designs:updated',
  'settings:updated',
  'invoices:updated',
  'users:updated',
  'activity:new',
  'listener:updated',
  'remote-wallet-forwarding:updated',
  'remote-wallet-notifications:updated'
] as const

export type SSEEventType = (typeof ALL_SSE_EVENT_TYPES)[number]

export type SSEStatus = 'connecting' | 'open' | 'closed'

/** Structural EventSource so tests and Node can inject an implementation. */
export interface EventSourceLike {
  addEventListener(
    type: string,
    listener: (event: { data?: string }) => void
  ): void
  close(): void
}

export type EventSourceConstructor = new (url: string) => EventSourceLike

export interface SubscribeEventsOptions {
  /** Absolute URL of the events endpoint (no query string). */
  url: string
  /** Fresh auth token per (re)connect — bare base64 NIP-98 event. */
  getToken: () => Promise<string>
  onEvent: (type: SSEEventType, data: Record<string, unknown>) => void
  /** Only listen for these types. Default: all. */
  types?: readonly SSEEventType[]
  onStatus?: (status: SSEStatus) => void
  EventSourceImpl?: EventSourceConstructor
}

const INITIAL_RETRY_MS = 1000
const MAX_RETRY_MS = 30_000

/**
 * Opens the SSE stream and keeps it alive with exponential-backoff reconnects
 * (1s → 30s). Returns an unsubscribe function.
 */
export function subscribeEvents(options: SubscribeEventsOptions): () => void {
  const Impl =
    options.EventSourceImpl ??
    (typeof EventSource !== 'undefined'
      ? (EventSource as unknown as EventSourceConstructor)
      : undefined)
  if (!Impl) {
    throw new Error(
      'EventSource is not available in this environment — pass EventSourceImpl'
    )
  }
  const Source: EventSourceConstructor = Impl

  const types = options.types ?? ALL_SSE_EVENT_TYPES
  let source: EventSourceLike | null = null
  let closed = false
  let retryMs = INITIAL_RETRY_MS
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleReconnect() {
    if (closed) return
    options.onStatus?.('closed')
    retryTimer = setTimeout(connect, retryMs)
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
  }

  async function connect() {
    if (closed) return
    options.onStatus?.('connecting')

    let token: string
    try {
      token = await options.getToken()
    } catch {
      scheduleReconnect()
      return
    }
    if (closed) return

    const es = new Source(`${options.url}?token=${encodeURIComponent(token)}`)
    source = es

    es.addEventListener('connected', () => {
      retryMs = INITIAL_RETRY_MS
      options.onStatus?.('open')
    })

    for (const type of types) {
      es.addEventListener(type, event => {
        let data: Record<string, unknown> = {}
        try {
          data = JSON.parse(event.data ?? '{}')
        } catch {
          // Malformed frame — deliver the type signal anyway.
        }
        options.onEvent(type, data)
      })
    }

    es.addEventListener('error', () => {
      es.close()
      if (source === es) source = null
      scheduleReconnect()
    })
  }

  connect()

  return () => {
    closed = true
    if (retryTimer) clearTimeout(retryTimer)
    source?.close()
    source = null
  }
}
