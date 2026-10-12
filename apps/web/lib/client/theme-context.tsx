'use client'

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback
} from 'react'
import { useSettings } from '@/lib/client/hooks/use-settings'
import {
  COLOR_STORAGE_KEY,
  DEFAULT_PRESET,
  DEFAULT_ROUNDING,
  presetVars,
  ROUNDING_OPTIONS,
  ROUNDING_STORAGE_KEY,
  ROUNDING_VALUES,
  THEME_PRESETS,
  type RoundingOption,
  type ThemePreset
} from '@/lib/client/theme-presets'

export { ROUNDING_OPTIONS, THEME_PRESETS }
export type { RoundingOption, ThemePreset }

// ─── Context ───────────────────────────────────────────────────────────────

interface ThemeContextValue {
  activePreset: ThemePreset
  setTheme: (preset: ThemePreset) => void
  presets: ThemePreset[]
  rounding: RoundingOption
  setRounding: (option: RoundingOption) => void
  roundingOptions: readonly (typeof ROUNDING_OPTIONS)[number][]
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
  for (const [name, value] of Object.entries(presetVars(preset))) {
    root.style.setProperty(name, value)
  }
}

function applyRounding(option: RoundingOption) {
  document.documentElement.style.setProperty(
    '--radius',
    ROUNDING_VALUES[option]
  )
}

function loadSavedPreset(): ThemePreset {
  if (typeof window === 'undefined') return DEFAULT_PRESET
  try {
    const saved = localStorage.getItem(COLOR_STORAGE_KEY)
    if (saved) {
      const found = THEME_PRESETS.find(p => p.hex === saved)
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
  const { data: settings } = useSettings()
  const [activePreset, setActivePreset] = useState<ThemePreset>(() =>
    loadSavedPreset()
  )
  const [rounding, setRoundingState] = useState<RoundingOption>(() =>
    loadSavedRounding()
  )

  useEffect(() => {
    applyPreset(activePreset)
  }, [activePreset])

  useEffect(() => {
    applyRounding(rounding)
  }, [rounding])

  // Hydrate from server settings through the shared API cache so branding,
  // theme, and page data all reuse the same `/api/settings` request.
  useEffect(() => {
    if (typeof settings?.brand_theme === 'string') {
      const preset = THEME_PRESETS.find(p => p.hex === settings.brand_theme)
      if (preset && preset.hex !== activePreset.hex) {
        setActivePreset(preset)
        applyPreset(preset)
        try {
          localStorage.setItem(COLOR_STORAGE_KEY, preset.hex)
        } catch {}
      }
    }

    if (
      typeof settings?.brand_rounding === 'string' &&
      (ROUNDING_OPTIONS as readonly string[]).includes(settings.brand_rounding)
    ) {
      const next = settings.brand_rounding as RoundingOption
      if (next !== rounding) {
        setRoundingState(next)
        applyRounding(next)
        try {
          localStorage.setItem(ROUNDING_STORAGE_KEY, next)
        } catch {}
      }
    }
  }, [
    activePreset.hex,
    rounding,
    settings?.brand_rounding,
    settings?.brand_theme
  ])

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
    <ThemeContext.Provider
      value={{
        activePreset,
        setTheme,
        presets: THEME_PRESETS,
        rounding,
        setRounding,
        roundingOptions: ROUNDING_OPTIONS
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}
