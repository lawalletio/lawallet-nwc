'use client'

import React from 'react'
import { cn } from '@/lib/utils'

/**
 * Reusable two-line "label + value" cell for the detail dialogs.
 * Mirrors the inline `InfoField` used in `apps/web/app/admin/cards/[id]/page.tsx`
 * so the three Connection Map dialogs feel like a natural extension of
 * the existing card detail page.
 *
 * Pass `mono` for IDs / hex strings so they wrap by character and the
 * width of the grid cell doesn't blow up when a 64-char string lands in
 * the value slot.
 */
export function InfoField({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={cn('text-sm', mono && 'break-all font-mono')}>
        {value}
      </div>
    </div>
  )
}
