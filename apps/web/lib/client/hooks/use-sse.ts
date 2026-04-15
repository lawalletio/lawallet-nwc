'use client'

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useAuth } from '@/components/admin/auth-context'
import { ALL_SSE_EVENT_TYPES, type SSEEventType } from '@/lib/events/event-types'

export type { SSEEventType }

interface SSEContextValue {
  connected: boolean
  versions: Record<SSEEventType, number>
}

const ALL_EVENT_TYPES = ALL_SSE_EVENT_TYPES

function initialVersions(): Record<SSEEventType, number> {
  return Object.fromEntries(ALL_EVENT_TYPES.map(t => [t, 0])) as Record<SSEEventType, number>
}

// ─── Context ──────────────────────────────────────────────────────────────

const SSEContext = createContext<SSEContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────

const MAX_RECONNECT_DELAY = 30_000
const INITIAL_RECONNECT_DELAY = 1_000

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const { status, jwt } = useAuth()
  const [connected, setConnected] = useState(false)
  const [versions, setVersions] = useState<Record<SSEEventType, number>>(initialVersions)
  const esRef = useRef<EventSource | null>(null)
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setConnected(false)
  }, [])

  const connect = useCallback((token: string) => {
    cleanup()

    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)
    esRef.current = es

    es.addEventListener('connected', () => {
      if (!mountedRef.current) return
      setConnected(true)
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY
    })

    // Listen for all event types
    for (const eventType of ALL_EVENT_TYPES) {
      es.addEventListener(eventType, () => {
        if (!mountedRef.current) return
        setVersions(prev => ({ ...prev, [eventType]: prev[eventType] + 1 }))
      })
    }

    es.onerror = () => {
      if (!mountedRef.current) return
      es.close()
      esRef.current = null
      setConnected(false)

      // Reconnect with exponential backoff
      const delay = reconnectDelayRef.current
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY)

      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current && token) {
          connect(token)
        }
      }, delay)
    }
  }, [cleanup])

  useEffect(() => {
    mountedRef.current = true

    if (status === 'authenticated' && jwt) {
      connect(jwt)
    } else {
      cleanup()
    }

    return () => {
      mountedRef.current = false
      cleanup()
    }
  }, [status, jwt, connect, cleanup])

  return React.createElement(
    SSEContext.Provider,
    { value: { connected, versions } },
    children
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────

/**
 * Returns the current version counter for an SSE event type.
 * The version increments each time a server event of that type is received.
 * Returns 0 if SSE context is unavailable (graceful degradation).
 */
export function useSSEVersion(eventType: SSEEventType | null): number {
  const ctx = useContext(SSEContext)
  if (!ctx || !eventType) return 0
  return ctx.versions[eventType]
}

/**
 * Returns whether the SSE connection is active.
 */
export function useSSEConnected(): boolean {
  const ctx = useContext(SSEContext)
  return ctx?.connected ?? false
}
