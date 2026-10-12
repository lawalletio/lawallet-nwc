import { describe, it, expect, beforeEach } from 'vitest'
import {
  COLOR_STORAGE_KEY,
  DEFAULT_PRESET,
  ROUNDING_STORAGE_KEY,
  THEME_PRESETS,
  themeBootScript
} from '@/lib/client/theme-presets'

const style = () => document.documentElement.style
const runBootScript = () => new Function(themeBootScript())()

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('style')
})

describe('themeBootScript', () => {
  it('applies the stored brand colour and rounding before React runs', () => {
    const pink = THEME_PRESETS.find(p => p.name === 'Pink')!
    localStorage.setItem(COLOR_STORAGE_KEY, pink.hex)
    localStorage.setItem(ROUNDING_STORAGE_KEY, 'Full')

    runBootScript()

    expect(style().getPropertyValue('--primary')).toBe(pink.primary)
    expect(style().getPropertyValue('--theme-300')).toBe(pink.theme300)
    expect(style().getPropertyValue('--radius')).toBe('1.5rem')
  })

  it('falls back to the default preset and leaves rounding to CSS when nothing is stored', () => {
    runBootScript()

    expect(style().getPropertyValue('--primary')).toBe(DEFAULT_PRESET.primary)
    expect(style().getPropertyValue('--radius')).toBe('')
  })

  it('ignores unknown stored values', () => {
    localStorage.setItem(COLOR_STORAGE_KEY, '#000000')
    localStorage.setItem(ROUNDING_STORAGE_KEY, 'Huge')

    runBootScript()

    expect(style().getPropertyValue('--primary')).toBe(DEFAULT_PRESET.primary)
    expect(style().getPropertyValue('--radius')).toBe('')
  })

  it('never throws when storage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      }
    })
    try {
      expect(runBootScript).not.toThrow()
    } finally {
      Object.defineProperty(window, 'localStorage', original)
    }
  })
})
