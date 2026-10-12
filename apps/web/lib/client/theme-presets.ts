// Plain module (no 'use client') so the server root layout can inline
// `themeBootScript()` while ThemeProvider keeps applying the same values.

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
  theme200: string // darkest — border, text-shadow
  theme300: string // border color
  theme400: string // lightest — gradient-to, inner shadow
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
    theme400: '#a3a3a3'
  },
  {
    name: 'Pink',
    hex: '#ec4899',
    primary: '330 81% 60%',
    primaryForeground: '0 0% 100%',
    ring: '330 81% 45%',
    theme200: '#9d174d',
    theme300: '#be185d',
    theme400: '#db2777'
  },
  {
    name: 'Orange',
    hex: '#f97316',
    primary: '25 95% 53%',
    primaryForeground: '0 0% 100%',
    ring: '25 95% 40%',
    theme200: '#9a3412',
    theme300: '#c2410c',
    theme400: '#ea580c'
  },
  {
    name: 'Yellow',
    hex: '#eab308',
    primary: '48 96% 47%',
    primaryForeground: '0 0% 3.9%',
    ring: '48 96% 35%',
    theme200: '#854d0e',
    theme300: '#a16207',
    theme400: '#ca8a04'
  },
  {
    name: 'Green',
    hex: '#22c55e',
    primary: '142 71% 45%',
    primaryForeground: '0 0% 100%',
    ring: '142 71% 35%',
    theme200: '#166534',
    theme300: '#15803d',
    theme400: '#16a34a'
  },
  {
    name: 'Blue',
    hex: '#3b82f6',
    primary: '217 91% 60%',
    primaryForeground: '0 0% 100%',
    ring: '217 91% 45%',
    theme200: '#1e40af',
    theme300: '#1d4ed8',
    theme400: '#2563eb'
  },
  {
    name: 'Violet',
    hex: '#8b5cf6',
    primary: '258 90% 66%',
    primaryForeground: '0 0% 100%',
    ring: '258 90% 50%',
    theme200: '#5b21b6',
    theme300: '#6d28d9',
    theme400: '#7c3aed'
  },
  {
    name: 'Purple',
    hex: '#a855f7',
    primary: '270 91% 65%',
    primaryForeground: '0 0% 100%',
    ring: '270 91% 50%',
    theme200: '#6b21a8',
    theme300: '#7e22ce',
    theme400: '#9333ea'
  }
]

// ─── Rounding presets ─────────────────────────────────────────────────────

export const ROUNDING_OPTIONS = ['None', 'Small', 'Medium', 'Full'] as const
export type RoundingOption = (typeof ROUNDING_OPTIONS)[number]

export const ROUNDING_VALUES: Record<RoundingOption, string> = {
  None: '0rem',
  Small: '0.375rem',
  Medium: '0.75rem',
  Full: '1.5rem'
}

export const COLOR_STORAGE_KEY = 'lawallet-theme-color'
export const ROUNDING_STORAGE_KEY = 'lawallet-theme-rounding'
export const DEFAULT_PRESET = THEME_PRESETS[4] // Green (matches Figma design system)
export const DEFAULT_ROUNDING: RoundingOption = 'Medium'

/** The CSS custom properties a preset sets on `<html>`. */
export function presetVars(preset: ThemePreset): Record<string, string> {
  return {
    '--primary': preset.primary,
    '--primary-foreground': preset.primaryForeground,
    '--ring': preset.ring,
    '--sidebar-primary': preset.primary,
    '--sidebar-primary-foreground': preset.primaryForeground,
    '--sidebar-ring': preset.ring,
    // Theme button gradient stops
    '--theme-200': preset.theme200,
    '--theme-300': preset.theme300,
    '--theme-400': preset.theme400
  }
}

/**
 * Inline `<head>` script: applies the stored brand colour and rounding
 * before first paint, so the page doesn't flash the CSS defaults until
 * ThemeProvider's effect runs. Falls back to the default preset (what the
 * provider applies anyway) and never throws.
 */
export function themeBootScript(): string {
  const presets = Object.fromEntries(
    THEME_PRESETS.map(p => [p.hex, presetVars(p)])
  )
  return `(function(){try{var P=${JSON.stringify(presets)},R=${JSON.stringify(
    ROUNDING_VALUES
  )},s=document.documentElement.style,c=localStorage.getItem(${JSON.stringify(
    COLOR_STORAGE_KEY
  )}),r=localStorage.getItem(${JSON.stringify(
    ROUNDING_STORAGE_KEY
  )}),p=(c&&P[c])||P[${JSON.stringify(
    DEFAULT_PRESET.hex
  )}];for(var k in p)s.setProperty(k,p[k]);if(r&&R[r])s.setProperty('--radius',R[r])}catch(e){}})()`
}
