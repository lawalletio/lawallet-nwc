'use client'

import { useState } from 'react'
import { VenetianMask } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { isDevEnv, startImpersonation } from '@/lib/client/dev-impersonation'

/**
 * Dev-only row action: view the app as this user. Renders nothing outside
 * `development`. Stops click propagation so it doesn't also trigger the row's
 * navigate-to-detail handler.
 */
export function ImpersonateUserButton({
  pubkey,
  className,
}: {
  pubkey: string
  className?: string
}) {
  const [loading, setLoading] = useState(false)

  if (!isDevEnv()) return null

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    setLoading(true)
    try {
      await startImpersonation(pubkey)
      window.location.href = '/wallet'
    } catch (err) {
      setLoading(false)
      console.error('[dev] impersonate failed', err)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-label="Impersonate user (dev)"
      title="Impersonate user (dev)"
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-amber-400/15 hover:text-amber-500 disabled:opacity-50',
        className,
      )}
    >
      {loading ? <Spinner size={16} /> : <VenetianMask className="size-4" />}
    </button>
  )
}
