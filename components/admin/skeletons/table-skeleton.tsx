'use client'

import React from 'react'
import { Skeleton } from '@/components/ui/skeleton'

interface TableSkeletonProps {
  rows?: number
  columns?: number
}

export function TableSkeleton({ rows = 5, columns = 4 }: TableSkeletonProps) {
  return (
    <div className="rounded-md border">
      {/* Header */}
      <div className="flex items-center gap-4 border-b px-4 h-10">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={`r-${rowIdx}`}
          className="flex items-center gap-4 border-b last:border-0 px-4 h-12"
        >
          {Array.from({ length: columns }).map((_, colIdx) => (
            <Skeleton key={`r-${rowIdx}-c-${colIdx}`} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}
