'use client'

import { RefreshCw, WifiOff, Loader2 } from 'lucide-react'
import { nwcStatusLabel, type NwcStatus } from '@/lib/client/use-nwc-balance'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

interface BalanceHeaderProps {
  sats: number | null
  status: NwcStatus
  error: Error | null
  loading: boolean
  onRefresh?: () => void
  lightningAddress?: string | null
}

export function BalanceHeader({
  sats,
  status,
  error,
  loading,
  onRefresh,
  lightningAddress,
}: BalanceHeaderProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <StatusDot status={status} />
        {nwcStatusLabel(status)}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh balance"
            className="ml-1 flex size-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </button>
        )}
      </div>

      <div className="flex items-baseline gap-2 tabular-nums">
        {sats !== null ? (
          <>
            <span className="text-5xl font-semibold leading-none text-foreground">
              {sats.toLocaleString()}
            </span>
            <span className="text-lg font-normal text-muted-foreground">
              sats
            </span>
          </>
        ) : error ? (
          <span className="inline-flex items-center gap-2 text-base text-destructive">
            <WifiOff className="size-4" />
            Unavailable
          </span>
        ) : (
          <Spinner size={32} className="text-muted-foreground" />
        )}
      </div>

      {lightningAddress && (
        <span className="text-sm text-muted-foreground">
          {lightningAddress}
        </span>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: NwcStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 rounded-full',
        status === 'connected'
          ? 'bg-green-500'
          : status === 'disconnected'
            ? 'bg-red-500'
            : 'bg-amber-500 animate-pulse',
      )}
    />
  )
}
