'use client'

import { WifiOff } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { useNwcBalance } from '@/lib/client/use-nwc-balance'
import { cn } from '@/lib/utils'

/**
 * The wallet's live balance, sized to sit beside the wallet it belongs to
 * rather than in a card of its own. Renders nothing without a connection
 * string — an address in a mode with no NWC, or an admin viewing someone
 * else's address, simply has no balance to show.
 */
export function WalletBalanceInline({
  connectionString,
  className
}: {
  connectionString: string | null
  className?: string
}) {
  const balance = useNwcBalance(connectionString)
  if (!connectionString) return null

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs text-muted-foreground',
        className
      )}
    >
      {balance.sats !== null ? (
        <>
          <span className="font-medium tabular-nums text-foreground">
            {balance.sats.toLocaleString()}
          </span>
          sats
        </>
      ) : balance.error ? (
        <>
          <WifiOff className="size-3" aria-hidden />
          Unavailable
        </>
      ) : (
        <Spinner size={12} aria-label="Loading balance" />
      )}
    </span>
  )
}
