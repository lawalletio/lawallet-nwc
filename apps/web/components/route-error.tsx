'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Shared body for route-level `error.tsx` boundaries. Keeps the surrounding
 * layout (wallet shell, admin sidebar) mounted so one broken screen no longer
 * escalates to `global-error`, which replaces the whole document.
 */
export function RouteError({
  error,
  retry,
  homeHref
}: {
  error: Error & { digest?: string }
  retry: () => void
  homeHref: string
}) {
  // Same reporting path as app/global-error.tsx.
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
    import('@sentry/nextjs').then(Sentry => Sentry.captureException(error))
  }, [error])

  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <AlertTriangle className="size-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          This screen hit an unexpected error. Try again or go back home.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Button asChild variant="outline">
          <Link href={homeHref}>Go home</Link>
        </Button>
      </div>
    </div>
  )
}
