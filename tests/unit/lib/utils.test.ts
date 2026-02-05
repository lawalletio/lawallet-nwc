import { describe, it, expect } from 'vitest'
import { cn, formatDate, generateHexGroups } from '@/lib/utils'

describe('cn', () => {
  it('merges simple class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes via clsx', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible')
  })

  it('merges conflicting tailwind classes (last wins)', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2')
  })

  it('returns empty string with no inputs', () => {
    expect(cn()).toBe('')
  })

  it('handles arrays', () => {
    expect(cn(['foo', 'bar'])).toBe('foo bar')
  })

  it('handles undefined and null', () => {
    expect(cn('a', undefined, null, 'b')).toBe('a b')
  })
})

describe('formatDate', () => {
  it('returns empty string for undefined', () => {
    expect(formatDate(undefined)).toBe('')
  })

  it('returns the string as-is for string input', () => {
    expect(formatDate('2024-01-15')).toBe('2024-01-15')
  })

  it('returns number as string for number input', () => {
    expect(formatDate(1705276800000)).toBe('1705276800000')
  })

  it('returns locale date string for Date input', () => {
    const date = new Date('2024-01-15T00:00:00Z')
    const result = formatDate(date)
    expect(result).toBe(date.toLocaleDateString())
  })

  it('returns empty string for empty string input', () => {
    expect(formatDate('')).toBe('')
  })

  it('returns "0" for 0 input', () => {
    expect(formatDate(0)).toBe('')
  })
})

describe('generateHexGroups', () => {
  it('generates the correct number of groups', () => {
    const result = generateHexGroups(3)
    const groups = result.split(':')
    expect(groups).toHaveLength(3)
  })

  it('each group is a 2-char uppercase hex string', () => {
    const result = generateHexGroups(5)
    const groups = result.split(':')
    for (const group of groups) {
      expect(group).toMatch(/^[0-9A-F]{2}$/)
    }
  })

  it('returns empty string for 0 groups', () => {
    expect(generateHexGroups(0)).toBe('')
  })

  it('returns a single group without separator', () => {
    const result = generateHexGroups(1)
    expect(result).toMatch(/^[0-9A-F]{2}$/)
  })

  it('produces colon-separated format', () => {
    const result = generateHexGroups(4)
    expect(result).toMatch(/^[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}$/)
  })
})
