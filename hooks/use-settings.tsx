'use client'

import { useContext } from 'react'
import { SettingsContext } from '@/providers/settings'

export function useSettings() {
  const context = useContext(SettingsContext)
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider')
  }
  return context
}
