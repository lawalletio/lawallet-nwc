'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { type NwcStatus } from '@/lib/client/use-nwc-balance'
import { useT, type Dict } from '@/lib/client/i18n'
import { cn } from '@/lib/utils'

interface RelayErrorBadgeProps {
  status: NwcStatus
  error: Error | null
  /** Whether a cached value is currently rendering behind the badge. */
  hasCachedValue: boolean
  /** Calls `useNwcBalance().refetch()`. */
  onRetry: () => void
  className?: string
}

/**
 * Inline indicator for the wallet relay's connection state.
 *
 * - `connected` + no error → renders nothing.
 * - `disconnected` (or any error) with a cached value showing → small red
 *   dot, tappable to open a popover with the actual error message and a
 *   Retry action. The wallet stays usable; the dot just signals "stale".
 * - `disconnected` with no cache → a more prominent red chip with an
 *   AlertCircle icon, same popover behaviour. The user has nothing to
 *   look at while disconnected so we make the failure obvious.
 *
 * Uses Radix Popover (already installed); the trigger is the badge itself
 * so taps and clicks both feel natural on touch.
 */
export function RelayErrorBadge({
  status,
  error,
  hasCachedValue,
  onRetry,
  className
}: RelayErrorBadgeProps) {
  const t = useT()
  const inError = status === 'disconnected' || error !== null
  if (!inError) return null

  const message = humaniseError(error, t)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t.shared.relay.badge}
          className={cn(
            'inline-flex items-center gap-1 rounded-full transition-colors',
            hasCachedValue
              ? 'h-4 w-4 justify-center bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : 'h-7 px-2 text-xs font-medium border border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25',
            className
          )}
        >
          {hasCachedValue ? (
            <span
              className="size-2 rounded-full bg-destructive-foreground"
              aria-hidden
            />
          ) : (
            <>
              <AlertCircle className="size-3.5" />
              {t.shared.relay.offline}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72">
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">
                {t.shared.relay.title}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {message}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRetry}
            className="self-start"
          >
            <RefreshCw className="size-3.5" />
            {t.common.retry}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function humaniseError(error: Error | null, t: Dict): string {
  if (!error) return t.shared.relay.generic
  const msg = error.message
  if (/reply timeout/i.test(msg)) return t.shared.relay.timeout
  if (/failed to connect/i.test(msg)) return t.shared.relay.unreachable
  return msg
}
