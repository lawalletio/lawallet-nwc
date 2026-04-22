'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  /**
   * Optional shorter title shown only on mobile (below the `sm` breakpoint).
   * Falls back to `title` when unset. Useful when the desktop label is long
   * enough to truncate in a compact mobile stat grid (e.g. "Lightning
   * addresses" → "Addresses").
   */
  titleMobile?: string
  value: string | number | undefined
  description?: string
  badge?: { label: string; variant?: 'default' | 'secondary' | 'outline' }
  unit?: string
  /**
   * Short prefix rendered immediately before the value (e.g. a currency
   * symbol). Useful for sat-denominated stats where a leading "⚡" makes the
   * unit instantly recognizable without burning a full `unit` suffix slot.
   */
  prefix?: string
  secondary?: string
  loading?: boolean
  className?: string
}

export function StatCard({
  title,
  titleMobile,
  value,
  description,
  badge,
  unit,
  prefix,
  secondary,
  loading,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('', className)}>
      <CardContent className="p-3 sm:p-6">
        <div className="flex flex-col gap-1 sm:gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm text-muted-foreground truncate">
              {titleMobile ? (
                <>
                  <span className="sm:hidden">{titleMobile}</span>
                  <span className="hidden sm:inline">{title}</span>
                </>
              ) : (
                title
              )}
            </span>
            {badge && (
              <Badge variant={badge.variant ?? 'default'}>{badge.label}</Badge>
            )}
          </div>
          {loading ? (
            <Skeleton className="h-6 sm:h-8 w-20 sm:w-24" />
          ) : (
            <div className="flex items-baseline gap-1">
              {prefix && (
                <span className="text-base sm:text-lg text-muted-foreground">
                  {prefix}
                </span>
              )}
              <span className="text-xl sm:text-2xl font-semibold">
                {value ?? '—'}
              </span>
              {unit && (
                <span className="text-xs sm:text-sm text-muted-foreground">
                  {unit}
                </span>
              )}
              {secondary && (
                <span className="text-xs sm:text-sm text-muted-foreground">
                  {secondary}
                </span>
              )}
            </div>
          )}
          {description && (
            <p className="hidden sm:block text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
