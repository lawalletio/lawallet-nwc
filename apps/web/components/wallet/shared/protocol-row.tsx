import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * One protocol capability (LUD-21, NIP-57, …) with its availability badge and
 * an explanation of why it is or isn't on. Shared by the Lightning Address and
 * RemoteWallet capability panels, which describe the same protocols from two
 * different vantage points.
 */
export function ProtocolRow({
  icon,
  title,
  detail,
  enabled
}: {
  icon: ReactNode
  title: string
  detail: string
  enabled: boolean
}) {
  return (
    <div className="flex gap-3 px-5 py-4">
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
          enabled
            ? 'bg-emerald-500/10 text-emerald-500'
            : 'bg-muted text-muted-foreground'
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          <Badge
            variant={enabled ? 'outline' : 'secondary'}
            className={cn(
              enabled &&
                'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            )}
          >
            {enabled ? 'Enabled' : 'Unavailable'}
          </Badge>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {detail}
        </p>
      </div>
    </div>
  )
}
