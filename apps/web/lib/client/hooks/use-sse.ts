'use client'

import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import { useAuth } from '@/components/admin/auth-context'
import {
  ALL_SSE_EVENT_TYPES,
  type SSEEventType
} from '@/lib/events/event-types'

export type { SSEEventType }

// ─── Store ────────────────────────────────────────────────────────────────
// Module-level so each `useSSEVersion(type)` subscribes to its own type only:
// an `activity:new` bump re-renders the activity feed, not every `useApi`
// consumer on the page (which is what a single context value did).

const versions = new Map<SSEEventType, number>(
  ALL_SSE_EVENT_TYPES.map(t => [t, 0])
)
const typeListeners = new Map<SSEEventType, Set<() => void>>(
  ALL_SSE_EVENT_TYPES.map(t => [t, new Set()])
)
let connected = false
const connectedListeners = new Set<() => void>()

/** Bumps the counters for `types`, notifying only their subscribers. */
export function bumpSSEVersions(types: readonly SSEEventType[]): void {
  for (const type of types) {
    versions.set(type, (versions.get(type) ?? 0) + 1)
    typeListeners.get(type)?.forEach(listener => listener())
  }
}

function setConnected(next: boolean) {
  if (connected === next) return
  connected = next
  connectedListeners.forEach(listener => listener())
}

function subscribeType(type: SSEEventType, listener: () => void) {
  const set = typeListeners.get(type)!
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}

function subscribeConnected(listener: () => void) {
  connectedListeners.add(listener)
  return () => {
    connectedListeners.delete(listener)
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────

const MAX_RECONNECT_DELAY = 30_000
const INITIAL_RECONNECT_DELAY = 1_000

/** Exponential backoff with ±50% jitter so a server restart doesn't get every client back in the same second. */
export function reconnectDelay(attempt: number): number {
  const base = Math.min(
    INITIAL_RECONNECT_DELAY * 2 ** attempt,
    MAX_RECONNECT_DELAY
  )
  return Math.round(base * (0.5 + Math.random()))
}

/**
 * Owns the EventSource for the signed-in session. The stream is closed while
 * the tab is hidden (a background tab needs no live invalidations, and an
 * idle stream is a serverless function held open) and reopened on return.
 * Every reconnect after a drop bumps all counters, so anything that changed
 * while disconnected is refetched.
 */
export function SSEProvider({ children }: { children: ReactNode }) {
  const { status, jwt } = useAuth()

  useEffect(() => {
    if (status !== 'authenticated' || !jwt) return

    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let hasConnected = false
    // Set when the server recycles the stream on purpose (see the route's
    // `maxDuration`): the gap is one handshake, not worth a full refetch.
    let recycled = false
    let disposed = false

    function close() {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
      es?.close()
      es = null
      setConnected(false)
    }

    function connect() {
      close()
      if (disposed || document.hidden) return
      const source = new EventSource(
        `/api/events?token=${encodeURIComponent(jwt!)}`
      )
      es = source

      source.addEventListener('connected', () => {
        attempt = 0
        setConnected(true)
        if (hasConnected && !recycled) bumpSSEVersions(ALL_SSE_EVENT_TYPES)
        hasConnected = true
        recycled = false
      })

      source.addEventListener('recycle', () => {
        recycled = true
        connect()
      })

      for (const eventType of ALL_SSE_EVENT_TYPES) {
        source.addEventListener(eventType, () => bumpSSEVersions([eventType]))
      }

      source.onerror = () => {
        // Take over from EventSource's own retry so the backoff is ours.
        recycled = false
        close()
        if (disposed) return
        reconnectTimer = setTimeout(connect, reconnectDelay(attempt++))
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        recycled = false
        close()
      } else if (!es) {
        attempt = 0
        connect()
      }
    }

    connect()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      close()
    }
  }, [status, jwt])

  return children
}

// ─── Hooks ────────────────────────────────────────────────────────────────

/**
 * Returns the current version counter for an SSE event type.
 * The version increments each time a server event of that type is received,
 * and on every reconnect. Returns 0 for a null type.
 */
export function useSSEVersion(eventType: SSEEventType | null): number {
  const subscribe = useCallback(
    (listener: () => void) =>
      eventType ? subscribeType(eventType, listener) : () => {},
    [eventType]
  )
  return useSyncExternalStore(
    subscribe,
    () => (eventType ? (versions.get(eventType) ?? 0) : 0),
    () => 0
  )
}

/**
 * Returns whether the SSE connection is active.
 */
export function useSSEConnected(): boolean {
  return useSyncExternalStore(
    subscribeConnected,
    () => connected,
    () => false
  )
}
