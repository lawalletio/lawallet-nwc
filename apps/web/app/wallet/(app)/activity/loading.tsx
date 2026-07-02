import { Skeleton } from '@/components/ui/skeleton'

/** Route-level fallback for the activity list. */
export default function ActivityLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 px-5 pt-6" aria-hidden>
      <Skeleton className="h-6 w-28" />
      <div className="mt-2 flex flex-col gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}
