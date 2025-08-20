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

export function generateHexGroups(groups: number): string {
  return Array.from({ length: groups }, () => {
    const hex = Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
    return hex
  }).join(':')
}
