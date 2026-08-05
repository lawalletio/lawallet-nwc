'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Page stack for the server's opaque cursors. The API returns one page plus a
 * `nextCursor`, so walking backwards means remembering the cursors already
 * visited rather than asking the server for a previous page.
 */
export function useCursorPagination() {
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  return {
    cursor: cursors.at(-1) ?? null,
    page: cursors.length,
    next(nextCursor: string | null | undefined) {
      if (!nextCursor) return
      setCursors(current => [...current, nextCursor])
    },
    previous() {
      setCursors(current =>
        current.length > 1 ? current.slice(0, -1) : current
      )
    },
    reset() {
      setCursors([null])
    }
  }
}

export function CursorPagination({
  label,
  page,
  hasNext,
  loading,
  onPrevious,
  onNext
}: {
  label: string
  page: number
  hasNext: boolean
  loading: boolean
  onPrevious: () => void
  onNext: () => void
}) {
  if (page === 1 && !hasNext) return null
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3"
      aria-label={`${label} pagination`}
    >
      <span className="text-xs text-muted-foreground">Page {page}</span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page === 1 || loading}
          onClick={onPrevious}
          aria-label={`Previous ${label} page`}
        >
          <ChevronLeft data-icon="inline-start" />
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasNext || loading}
          onClick={onNext}
          aria-label={`Next ${label} page`}
        >
          Next
          <ChevronRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}
