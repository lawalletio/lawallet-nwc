import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Helper to safely format date-like values
export function formatDate(value: string | number | Date | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return value.toString()
  if (value instanceof Date) return value.toLocaleDateString()
  return String(value)
}
