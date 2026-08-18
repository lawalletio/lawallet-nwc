'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { Delete } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AmountKeypadProps {
  /** Current value as a string (retains leading zero / trailing decimal). */
  value: string
  onChange: (next: string) => void
  /** When true, hides the extra shortcut key. Sats amounts only. */
  integerOnly?: boolean
  /** Maximum number of integer digits. Defaults to 12 (≈ 1T sats). */
  maxDigits?: number
  /** Fixed minor-unit digits, e.g. 2 for fiat cents. */
  fixedDecimalDigits?: number
  /** Maximum number of digits after the decimal point. Defaults to unlimited. */
  maxDecimalDigits?: number
  /** Called when the user presses Enter on a physical keyboard. */
  onSubmit?: () => void
  /**
   * Note/comment field to hand typing over to: Tab, or any non-digit
   * character typed on a physical keyboard, focuses it.
   */
  noteRef?: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  disabled?: boolean
  className?: string
  buttonClassName?: string
}

const INTEGER_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  null,
  '0',
  'backspace'
] as const
const DECIMAL_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '00',
  '0',
  'backspace'
] as const

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
  fixedDecimalDigits,
  maxDecimalDigits,
  onSubmit,
  noteRef,
  disabled,
  className,
  buttonClassName
}: AmountKeypadProps) {
  const keys: readonly (Key | null)[] = integerOnly
    ? INTEGER_KEYS
    : DECIMAL_KEYS

  function press(key: Key) {
    if (disabled) return
    if (typeof fixedDecimalDigits === 'number' && fixedDecimalDigits > 0) {
      pressFixedDecimal(key, fixedDecimalDigits)
      return
    }

    if (key === 'backspace') {
      onChange(value.length <= 1 ? '0' : value.slice(0, -1))
      return
    }
    if (!value || value === '0') {
      onChange(key === '00' ? '0' : key)
      return
    }
    const digits = key

    // Cap by integer digits on the left of the decimal, or decimal precision
    // when the formatted value already contains a fractional part.
    const intPart = value.split('.')[0] ?? ''
    if (value.includes('.') && typeof maxDecimalDigits === 'number') {
      const decimalPart = value.split('.')[1] ?? ''
      const remaining = maxDecimalDigits - decimalPart.length
      if (remaining <= 0) return
      onChange(value + digits.slice(0, remaining))
      return
    }

    if (!value.includes('.') && intPart.length >= maxDigits) return
    const remaining = value.includes('.')
      ? digits.length
      : maxDigits - intPart.length
    onChange(value + digits.slice(0, remaining))
  }

  function pressFixedDecimal(key: Key, decimalDigits: number) {
    const currentDigits = minorUnitDigitsFromValue(value, decimalDigits)

    if (key === 'backspace') {
      const nextDigits =
        currentDigits.length <= 1 ? '0' : currentDigits.slice(0, -1)
      onChange(formatFixedDecimalValue(nextDigits, decimalDigits))
      return
    }

    const maxMinorDigits = maxDigits + decimalDigits
    const appendDigits = key
    const baseDigits = currentDigits === '0' ? '' : currentDigits
    const remaining = maxMinorDigits - baseDigits.length
    if (remaining <= 0) return

    const nextDigits = `${baseDigits}${appendDigits.slice(0, remaining)}` || '0'
    onChange(formatFixedDecimalValue(nextDigits, decimalDigits))
  }

  // Physical keyboard mirrors the on-screen keys. Listener lives on the
  // window so the keypad works without holding focus; refs keep it
  // subscribed once instead of re-binding on every keystroke.
  const pressRef = useRef(press)
  const submitRef = useRef(onSubmit)
  const noteElRef = useRef(noteRef)
  useEffect(() => {
    pressRef.current = press
    submitRef.current = onSubmit
    noteElRef.current = noteRef
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      // Focused buttons/links handle Enter and Space natively.
      if (target?.closest('button, a')) return

      // Enter submits from anywhere on the page, including the note field.
      if (event.key === 'Enter') {
        if (!submitRef.current) return
        event.preventDefault()
        submitRef.current()
        return
      }

      if (
        target?.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }

      const note = noteElRef.current?.current
      if (note && event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault()
        note.focus()
        return
      }
      if (note && event.key.length === 1 && !/^[0-9]$/.test(event.key)) {
        // Not preventDefault'd: the character lands in the note field.
        note.focus()
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault()
        pressRef.current('backspace')
        return
      }
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault()
        pressRef.current(event.key as Key)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div
      className={cn(
        'grid grid-cols-3 gap-3 select-none',
        disabled && 'opacity-50 pointer-events-none',
        className
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
            onClick={event => {
              press(key)
              // Drop focus so a following Enter submits instead of
              // re-pressing the clicked digit.
              event.currentTarget.blur()
            }}
            className={cn(
              'flex h-14 items-center justify-center rounded-xl bg-card text-2xl font-semibold text-foreground',
              'transition-colors hover:bg-accent active:scale-[0.98] active:bg-accent',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              buttonClassName
            )}
            aria-label={
              key === 'backspace' ? 'Delete last digit' : `Enter ${key}`
            }
          >
            {key === 'backspace' ? <Delete className="size-6" /> : key}
          </button>
        )
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

function minorUnitDigitsFromValue(raw: string, decimalDigits: number): string {
  const [integerRaw = '', decimalRaw = ''] = raw.split('.')
  const integerDigits = integerRaw.replace(/\D/g, '')
  const decimalPart = decimalRaw
    .replace(/\D/g, '')
    .padEnd(decimalDigits, '0')
    .slice(0, decimalDigits)
  const digits = `${integerDigits}${decimalPart}`.replace(/^0+(?=\d)/, '')
  return digits || '0'
}

function formatFixedDecimalValue(
  digits: string,
  decimalDigits: number
): string {
  const normalized = digits.replace(/\D/g, '').replace(/^0+(?=\d)/, '') || '0'
  const padded = normalized.padStart(decimalDigits + 1, '0')
  const integerPart =
    padded.slice(0, -decimalDigits).replace(/^0+(?=\d)/, '') || '0'
  const decimalPart = padded.slice(-decimalDigits)
  return `${integerPart}.${decimalPart}`
}
