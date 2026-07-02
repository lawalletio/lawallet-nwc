import { Skeleton } from '@/components/ui/skeleton'

/**
 * Route-level fallback for the wallet home. Mirrors `HomeScreen`'s layout
 * (avatar row → balance → Receive/Send → recent activity) so the transition
 * paints structure instead of a spinner.
 */
export default function HomeLoading() {
  return (
    <div className="flex flex-1 flex-col gap-6 px-5 pt-6" aria-hidden>
      {/* Top bar: avatar + name */}
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Balance */}
      <div className="mt-6 flex flex-col items-center gap-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-3 w-24" />
      </div>

      {/* Actions */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Skeleton className="h-12 rounded-full" />
        <Skeleton className="h-12 rounded-full" />
      </div>

      {/* Recent activity */}
      <div className="mt-6 flex flex-col gap-3">
        <Skeleton className="h-3 w-28" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
    </div>
  )
}
