'use client'

import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Visual banner for "the server / database failed us" states.
 *
 * Renders nothing when `error` is null, so callers can drop it inline at the
 * top of a page without extra conditionals:
 *
 * ```tsx
 * const { data, error, refetch } = useApi<...>('/api/users/me')
 * return (
 *   <>
 *     <EndpointError error={error} onRetry={refetch} />
 *     {!error && ...normal UI...}
 *   </>
 * )
 * ```
 *
 * Surfacing the original error message matters: when Postgres is down the
 * server's `InternalServerError` already carries a useful string ("database
 * unavailable", "ECONNREFUSED", etc.) and we shouldn't swallow it behind a
 * generic "something went wrong" — users debugging their own self-hosted
 * instance need the real cause.
 */
export interface EndpointErrorProps {
  error: Error | null | undefined
  /** Human-readable label for what failed to load. Shown in the heading. */
  label?: string
  /** Callback to re-run the failed fetch. Usually the `refetch` from useApi. */
  onRetry?: () => void
  className?: string
}

export function EndpointError({
  error,
  label = 'Service unavailable',
  onRetry,
  className = '',
}: EndpointErrorProps) {
  if (!error) return null

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 ${className}`}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
        <AlertTriangle className="size-5 text-destructive" />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <h3 className="text-sm font-semibold text-destructive">{label}</h3>
        <p className="break-words text-xs text-muted-foreground">
          {error.message || 'Unknown error'}
        </p>
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <RefreshCw className="mr-1 size-3.5" />
          Retry
        </Button>
      )}
    </div>
  )
}
