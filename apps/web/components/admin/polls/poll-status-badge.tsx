import { cn } from '@/lib/utils'
import type { AdminPoll } from './poll-form-dialog'

const STYLES: Record<AdminPoll['status'], { label: string; dot: string }> = {
  OPEN: { label: 'Open', dot: 'bg-emerald-500 animate-pulse' },
  DRAFT: { label: 'Draft', dot: 'bg-muted-foreground/50' },
  CLOSED: { label: 'Closed', dot: 'bg-rose-500' }
}

export function PollStatusBadge({
  status,
  className
}: {
  status: AdminPoll['status']
  className?: string
}) {
  const style = STYLES[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        className
      )}
    >
      <span className={cn('size-1.5 rounded-full', style.dot)} />
      {style.label}
    </span>
  )
}
