'use client'

import { cn } from '@/lib/utils'

interface AmountDisplayProps {
  /** Keypad string (may include trailing `.` or leading `0`). */
  value: string
  unit?: string
  className?: string
  subline?: string
}

/**
 * Large tabular display for amount input. Groups integer digits with
 * commas but preserves the raw decimal tail so a trailing `.` or `5.0`
 * doesn't get reformatted while the user is still typing.
 */
export function AmountDisplay({
  value,
  unit = 'sats',
  className,
  subline,
}: AmountDisplayProps) {
  const formatted = formatKeypadValue(value)

  return (
    <div className={cn('flex flex-col items-center gap-2 py-8', className)}>
      <div className="flex items-baseline gap-2 tabular-nums">
        <span className="text-5xl font-semibold leading-none text-foreground">
          {formatted}
        </span>
        <span className="text-lg font-normal text-muted-foreground">
          {unit}
        </span>
      </div>
      {subline && (
        <span className="text-sm text-muted-foreground">{subline}</span>
      )}
    </div>
  )
}

function formatKeypadValue(raw: string): string {
  if (!raw) return '0'
  const [intPartRaw, decimalPart] = raw.split('.')
  const intPart = intPartRaw ?? '0'
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (raw.includes('.')) {
    return `${grouped}.${decimalPart ?? ''}`
  }
  return grouped
}
