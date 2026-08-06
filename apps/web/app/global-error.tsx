'use client'

import { useEffect } from 'react'

// global-error replaces the root layout, so this renders its own <html> and
// deliberately imports no app CSS.
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
    import('@sentry/nextjs').then(Sentry => Sentry.captureException(error))
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: '1rem',
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        <h1>Something went wrong</h1>
        <p>An unexpected error occurred.</p>
        <button onClick={() => reset()}>Try again</button>
      </body>
    </html>
  )
}
