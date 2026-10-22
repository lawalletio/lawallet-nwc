import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// Mirrors `SettingsScreen`: header, then Account / Preferences / Support
// groups of 3, 3 and 2 rows, so the real screen swaps in without a jump.
const GROUPS = [
  { label: 'w-20', rows: ['w-24', 'w-20', 'w-32'] },
  { label: 'w-24', rows: ['w-24', 'w-28', 'w-32'] },
  { label: 'w-16', rows: ['w-28', 'w-28'] }
]

/** Route-level fallback for the wallet settings screen. */
export default function SettingsLoading() {
  return (
    <div className="flex flex-1 flex-col pb-32" aria-hidden>
      <div className="grid h-14 grid-cols-3 items-center px-3">
        <Skeleton className="h-9 w-20 rounded-full bg-card" />
        <Skeleton className="mx-auto h-5 w-20" />
      </div>

      <div className="flex flex-1 flex-col gap-6 px-4 pt-4">
        {GROUPS.map((group, g) => (
          <div key={g} className="flex flex-col gap-2">
            <Skeleton className={cn('h-4', group.label)} />
            <div className="flex flex-col overflow-hidden rounded-2xl bg-card">
              {group.rows.map((width, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex h-14 items-center justify-between gap-3 px-4',
                    i < group.rows.length - 1 && 'border-b border-border/40'
                  )}
                >
                  <Skeleton className={cn('h-4', width)} />
                  <Skeleton className="size-5 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-col items-center gap-1.5 py-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  )
}
