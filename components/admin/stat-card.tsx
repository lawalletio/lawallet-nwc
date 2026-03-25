'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string | number | undefined
  description?: string
  badge?: { label: string; variant?: 'default' | 'secondary' | 'outline' }
  unit?: string
  secondary?: string
  loading?: boolean
  className?: string
}

export function StatCard({
  title,
  value,
  description,
  badge,
  unit,
  secondary,
  loading,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('', className)}>
      <CardContent className="p-6">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{title}</span>
            {badge && (
              <Badge variant={badge.variant ?? 'default'}>{badge.label}</Badge>
            )}
          </div>
          {loading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-semibold">{value ?? '—'}</span>
              {unit && (
                <span className="text-sm text-muted-foreground">{unit}</span>
              )}
              {secondary && (
                <span className="text-sm text-muted-foreground">{secondary}</span>
              )}
            </div>
          )}
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
