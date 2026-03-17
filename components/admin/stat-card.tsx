'use client'

import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string | number | undefined
  icon: React.ComponentType<{ className?: string }>
  loading?: boolean
  className?: string
}

export function StatCard({ title, value, icon: Icon, loading, className }: StatCardProps) {
  return (
    <Card className={cn('', className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">{title}</span>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <span className="text-2xl font-semibold">{value ?? '—'}</span>
            )}
          </div>
          <div className="flex size-10 items-center justify-center rounded-md bg-muted">
            <Icon className="size-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
