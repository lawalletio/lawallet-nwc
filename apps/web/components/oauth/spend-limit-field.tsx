'use client'

import { useState } from 'react'
import { Check, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** The typed limit as a number, or NaN when it is not a whole number of sats. */
export function parseSpendLimit(text: string): number {
  return /^\d+$/.test(text) ? Number(text) : NaN
}

export function spendLimitValid(text: string, max: number): boolean {
  const limit = parseSpendLimit(text)
  return limit >= 1 && limit <= max
}

/**
 * The daily spend limit of a connection. Collapsed to a one-line summary
 * with an Edit button; it opens on its own while the value is invalid, so an
 * error is never hidden.
 */
export function SpendLimitField({
  id,
  value,
  onChange,
  max,
  disabled
}: {
  id: string
  value: string
  onChange: (value: string) => void
  max: number
  disabled?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const limit = parseSpendLimit(value)
  const valid = spendLimitValid(value, max)
  const open = editing || !valid
  const hintId = `${id}-hint`

  if (!open) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 p-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Daily limit</p>
          <p className="text-sm text-foreground">
            <span className="font-medium tabular-nums">
              {limit.toLocaleString()} sats
            </span>{' '}
            <span className="text-muted-foreground">every 24 hours</span>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setEditing(true)}
          disabled={disabled}
          aria-label="Edit daily limit"
        >
          <Pencil className="size-3.5" />
          Edit
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3">
      <Label htmlFor={id}>Daily limit (sats)</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          step={1}
          required
          autoFocus={editing}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && valid) {
              e.preventDefault()
              setEditing(false)
            }
          }}
          disabled={disabled}
          aria-invalid={!valid}
          aria-describedby={hintId}
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => setEditing(false)}
          disabled={disabled || !valid}
        >
          <Check className="size-3.5" />
          Done
        </Button>
      </div>
      <p
        id={hintId}
        aria-live="polite"
        className={cn(
          'text-xs',
          valid ? 'text-muted-foreground' : 'text-destructive'
        )}
      >
        {valid
          ? `The app can send up to ${limit.toLocaleString()} sats every 24 hours, fees included, without asking you again.`
          : `Enter a whole number of sats from 1 to ${max.toLocaleString()}.`}
      </p>
    </div>
  )
}
