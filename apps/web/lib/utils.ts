import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn/ui's class-name helper: combines `clsx` (conditional class lists) with
 * `tailwind-merge` (resolves conflicting Tailwind utilities, last one wins).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Coerces any date-like input to a display string. Strings pass through
 * unchanged so already-formatted server values aren't reformatted client-side.
 */
export function formatDate(value: string | number | Date | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return value.toString()
  if (value instanceof Date) return value.toLocaleDateString()
  return String(value)
}

/**
 * Generates `groups` random uppercase hex octets joined by `:` —
 * e.g. `generateHexGroups(3)` → `"A1:B2:C3"`. Used to seed displayed card UIDs.
 */
export function generateHexGroups(groups: number): string {
  return Array.from({ length: groups }, () => {
    const hex = Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
    return hex
  }).join(':')
}
