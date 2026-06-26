'use client'

import { useSyncExternalStore } from 'react'
import { isImpersonating, stopImpersonation } from '@/lib/client/dev-impersonation'

// No live subscription needed — the flag only changes across a full reload.
const noopSubscribe = () => () => {}

/**
 * Dev-banner control shown only while an impersonation session is active.
 * Reverts to the stashed admin session and returns to the Users table.
 *
 * Self-contained (reads localStorage directly) because the dev banner renders
 * outside the AuthProvider. `useSyncExternalStore` reads the flag on the client
 * with a `false` server snapshot, so it's hydration-safe with no effect.
 */
export function DevImpersonationControl() {
  const active = useSyncExternalStore(
    noopSubscribe,
    () => isImpersonating(),
    () => false,
  )

  if (!active) return null

  function stop() {
    stopImpersonation()
    window.location.href = '/admin/users'
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded bg-black/80 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-amber-300">
        Impersonating
      </span>
      <button
        type="button"
        onClick={stop}
        className="rounded bg-black/80 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-amber-300 transition-colors hover:bg-black"
      >
        Stop
      </button>
    </span>
  )
}
