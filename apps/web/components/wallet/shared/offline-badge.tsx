'use client'

import { useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'
import {
  isApiReachable,
  subscribeApiReachability
} from '@/lib/client/api-reachability'
import { useT } from '@/lib/client/i18n'

/**
 * Small "offline mode" pill shown while the API is unreachable, i.e. the
 * wallet is rendering its last-known cached data. The live region stays
 * mounted so screen readers announce the change.
 */
export function OfflineBadge() {
  const t = useT()
  const reachable = useSyncExternalStore(
    subscribeApiReachability,
    isApiReachable,
    () => true
  )

  return (
    <div role="status" aria-live="polite">
      {!reachable && (
        <div className="flex justify-center pt-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-500">
            <WifiOff className="size-3" aria-hidden />
            {t.shared.offlineMode}
          </span>
        </div>
      )}
    </div>
  )
}
