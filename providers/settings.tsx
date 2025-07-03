'use client'

import { createContext, ReactNode, useCallback, useState } from 'react'

export interface Settings {
  url?: string
  domain?: string
}

export interface SettingsContextType {
  settings: Settings
  updateSettings: (settings: Partial<Settings>) => void
  isLoading: boolean
}

export const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined
)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [settings, setSettings] = useState<Settings>({
    domain: process.env.NEXT_PUBLIC_DOMAIN || 'localhost:3000',
    url: process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'
  })

  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    // Save them and setSettings then
    console.error('Not implemented yet')
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, isLoading }}>
      {children}
    </SettingsContext.Provider>
  )
}
