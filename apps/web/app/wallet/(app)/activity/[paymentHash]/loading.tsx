import { Skeleton } from '@/components/ui/skeleton'

/** Route-level fallback for a single transaction receipt. */
export default function ActivityDetailLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 px-5 pt-6" aria-hidden>
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="mt-6 flex flex-col items-center gap-4">
        <Skeleton className="size-20 rounded-full" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-10 w-40" />
      </div>
    </div>
  )
}
