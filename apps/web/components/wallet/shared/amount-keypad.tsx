'use client'

import { Delete } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AmountKeypadProps {
  /** Current value as a string (retains leading zero / trailing decimal). */
  value: string
  onChange: (next: string) => void
  /** When true, rejects `.` presses. Sats amounts only. */
  integerOnly?: boolean
  /** Maximum number of integer digits. Defaults to 12 (≈ 1T sats). */
  maxDigits?: number
  disabled?: boolean
  className?: string
}

const INTEGER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'backspace'] as const
const DECIMAL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'] as const

type Key = (typeof DECIMAL_KEYS)[number]

/**
 * Numeric keypad used across send/receive flows. Stateless — parent owns
 * the string representation so it can format `1234` as `1,234` in the
 * display without fighting the input state.
 */
export function AmountKeypad({
  value,
  onChange,
  integerOnly = true,
  maxDigits = 12,
  disabled,
  className,
}: AmountKeypadProps) {
  const keys: readonly (Key | null)[] = integerOnly ? INTEGER_KEYS : DECIMAL_KEYS

  function press(key: Key) {
    if (disabled) return
    if (key === 'backspace') {
      onChange(value.length <= 1 ? '0' : value.slice(0, -1))
      return
    }
    if (key === '.') {
      if (value.includes('.')) return
      onChange(value === '' || value === '0' ? '0.' : `${value}.`)
      return
    }
    // Digit 0-9
    if (value === '0') {
      onChange(key)
      return
    }
    // Cap by integer digits on the left of the decimal.
    const intPart = value.split('.')[0] ?? ''
    if (!value.includes('.') && intPart.length >= maxDigits) return
    onChange(value + key)
  }

  return (
    <div
      className={cn(
        'grid grid-cols-3 gap-3 select-none',
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
      role="group"
      aria-label="Amount keypad"
    >
      {keys.map((key, index) =>
        key === null ? (
          <span key={`empty-${index}`} />
        ) : (
          <button
            key={key + index}
            type="button"
            onClick={() => press(key)}
            className={cn(
              'flex h-14 items-center justify-center rounded-xl bg-card text-2xl font-semibold text-foreground',
              'transition-colors hover:bg-accent active:scale-[0.98] active:bg-accent',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            aria-label={key === 'backspace' ? 'Delete last digit' : `Enter ${key}`}
          >
            {key === 'backspace' ? <Delete className="size-6" /> : key}
          </button>
        ),
      )}
    </div>
  )
}

/** Parses the keypad string back to a number. Returns null for empty or `.`. */
export function parseKeypadValue(raw: string): number | null {
  if (!raw || raw === '.' || raw === '0') return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}
