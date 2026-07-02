import { Skeleton } from '@/components/ui/skeleton'

/** Route-level fallback for the wallet settings screen. */
export default function SettingsLoading() {
  return (
    <div className="flex flex-1 flex-col gap-4 px-5 pt-6" aria-hidden>
      <Skeleton className="h-6 w-28" />
      <div className="mt-4 flex flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="size-6 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}
