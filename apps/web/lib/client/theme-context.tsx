'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

// ─── Theme color presets ───────────────────────────────────────────────────
// Each preset defines HSL values for --primary and gradient stops for
// the Button "theme" variant (border, gradient from/to, inner shadow).

export interface ThemePreset {
  name: string
  hex: string
  primary: string
  primaryForeground: string
  ring: string
  // Gradient stops for "theme" button variant (darker → lighter of the accent)
  theme200: string  // darkest — border, text-shadow
  theme300: string  // border color
  theme400: string  // lightest — gradient-to, inner shadow
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    name: 'Neutral',
    hex: '#f5f5f5',
    primary: '0 0% 96.1%',
    primaryForeground: '0 0% 3.9%',
    ring: '0 0% 45.1%',
    theme200: '#404040',
    theme300: '#404040',
    theme400: '#a3a3a3',
  },
  {
    name: 'Pink',
    hex: '#ec4899',
    primary: '330 81% 60%',
    primaryForeground: '0 0% 100%',
    ring: '330 81% 45%',
    theme200: '#9d174d',
    theme300: '#be185d',
    theme400: '#db2777',
  },
  {
    name: 'Orange',
    hex: '#f97316',
    primary: '25 95% 53%',
    primaryForeground: '0 0% 100%',
    ring: '25 95% 40%',
    theme200: '#9a3412',
    theme300: '#c2410c',
    theme400: '#ea580c',
  },
  {
    name: 'Yellow',
    hex: '#eab308',
    primary: '48 96% 47%',
    primaryForeground: '0 0% 3.9%',
    ring: '48 96% 35%',
    theme200: '#854d0e',
    theme300: '#a16207',
    theme400: '#ca8a04',
  },
  {
    name: 'Green',
    hex: '#22c55e',
    primary: '142 71% 45%',
    primaryForeground: '0 0% 100%',
    ring: '142 71% 35%',
    theme200: '#166534',
    theme300: '#15803d',
    theme400: '#16a34a',
  },
  {
    name: 'Blue',
    hex: '#3b82f6',
    primary: '217 91% 60%',
    primaryForeground: '0 0% 100%',
    ring: '217 91% 45%',
    theme200: '#1e40af',
    theme300: '#1d4ed8',
    theme400: '#2563eb',
  },
  {
    name: 'Violet',
    hex: '#8b5cf6',
    primary: '258 90% 66%',
    primaryForeground: '0 0% 100%',
    ring: '258 90% 50%',
    theme200: '#5b21b6',
    theme300: '#6d28d9',
    theme400: '#7c3aed',
  },
  {
    name: 'Purple',
    hex: '#a855f7',
    primary: '270 91% 65%',
    primaryForeground: '0 0% 100%',
    ring: '270 91% 50%',
    theme200: '#6b21a8',
    theme300: '#7e22ce',
    theme400: '#9333ea',
  },
]

// ─── Rounding presets ─────────────────────────────────────────────────────

export const ROUNDING_OPTIONS = ['None', 'Small', 'Medium', 'Full'] as const
export type RoundingOption = typeof ROUNDING_OPTIONS[number]

const ROUNDING_VALUES: Record<RoundingOption, string> = {
  None: '0rem',
  Small: '0.375rem',
  Medium: '0.75rem',
  Full: '1.5rem',
}

const COLOR_STORAGE_KEY = 'lawallet-theme-color'
const ROUNDING_STORAGE_KEY = 'lawallet-theme-rounding'
const DEFAULT_PRESET = THEME_PRESETS[4] // Green (matches Figma design system)
const DEFAULT_ROUNDING: RoundingOption = 'Medium'

// ─── Context ───────────────────────────────────────────────────────────────

interface ThemeContextValue {
  activePreset: ThemePreset
  setTheme: (preset: ThemePreset) => void
  presets: ThemePreset[]
  rounding: RoundingOption
  setRounding: (option: RoundingOption) => void
  roundingOptions: readonly typeof ROUNDING_OPTIONS[number][]
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

// ─── Provider ──────────────────────────────────────────────────────────────

function applyPreset(preset: ThemePreset) {
  const root = document.documentElement
  root.style.setProperty('--primary', preset.primary)
  root.style.setProperty('--primary-foreground', preset.primaryForeground)
  root.style.setProperty('--ring', preset.ring)
  root.style.setProperty('--sidebar-primary', preset.primary)
  root.style.setProperty('--sidebar-primary-foreground', preset.primaryForeground)
  root.style.setProperty('--sidebar-ring', preset.ring)
  // Theme button gradient stops
  root.style.setProperty('--theme-200', preset.theme200)
  root.style.setProperty('--theme-300', preset.theme300)
  root.style.setProperty('--theme-400', preset.theme400)
}

function applyRounding(option: RoundingOption) {
  document.documentElement.style.setProperty('--radius', ROUNDING_VALUES[option])
}

function loadSavedPreset(): ThemePreset {
  if (typeof window === 'undefined') return DEFAULT_PRESET
  try {
    const saved = localStorage.getItem(COLOR_STORAGE_KEY)
    if (saved) {
      const found = THEME_PRESETS.find((p) => p.hex === saved)
      if (found) return found
    }
  } catch {}
  return DEFAULT_PRESET
}

function loadSavedRounding(): RoundingOption {
  if (typeof window === 'undefined') return DEFAULT_ROUNDING
  try {
    const saved = localStorage.getItem(ROUNDING_STORAGE_KEY)
    if (saved && ROUNDING_OPTIONS.includes(saved as RoundingOption)) {
      return saved as RoundingOption
    }
  } catch {}
  return DEFAULT_ROUNDING
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [activePreset, setActivePreset] = useState<ThemePreset>(() => loadSavedPreset())
  const [rounding, setRoundingState] = useState<RoundingOption>(() => loadSavedRounding())

  useEffect(() => {
    applyPreset(activePreset)
  }, [activePreset])

  useEffect(() => {
    applyRounding(rounding)
  }, [rounding])

  // Hydrate from server settings once on mount so the branding is global
  // across all visitors (not just the admin who set it).
  useEffect(() => {
    let cancelled = false
    fetch('/api/settings')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return
        if (typeof data.brand_theme === 'string') {
          const preset = THEME_PRESETS.find(p => p.hex === data.brand_theme)
          if (preset && preset.hex !== activePreset.hex) {
            setActivePreset(preset)
            applyPreset(preset)
            try {
              localStorage.setItem(COLOR_STORAGE_KEY, preset.hex)
            } catch {}
          }
        }
        if (
          typeof data.brand_rounding === 'string' &&
          (ROUNDING_OPTIONS as readonly string[]).includes(data.brand_rounding)
        ) {
          const next = data.brand_rounding as RoundingOption
          if (next !== rounding) {
            setRoundingState(next)
            applyRounding(next)
            try {
              localStorage.setItem(ROUNDING_STORAGE_KEY, next)
            } catch {}
          }
        }
      })
      .catch(() => {
        // Ignore — client keeps whatever it loaded from localStorage / defaults.
      })
    return () => {
      cancelled = true
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setTheme = useCallback((preset: ThemePreset) => {
    setActivePreset(preset)
    applyPreset(preset)
    try {
      localStorage.setItem(COLOR_STORAGE_KEY, preset.hex)
    } catch {}
  }, [])

  const setRounding = useCallback((option: RoundingOption) => {
    setRoundingState(option)
    applyRounding(option)
    try {
      localStorage.setItem(ROUNDING_STORAGE_KEY, option)
    } catch {}
  }, [])

  return (
    <ThemeContext.Provider value={{ activePreset, setTheme, presets: THEME_PRESETS, rounding, setRounding, roundingOptions: ROUNDING_OPTIONS }}>
      {children}
    </ThemeContext.Provider>
  )
}
