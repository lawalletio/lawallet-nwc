'use client'

import {
  createContext,
  ReactNode,
  useCallback,
  useEffect,
  useState
} from 'react'

export interface Settings {
  url?: string
  domain?: string
}

export interface SettingsContextType {
  settings: Settings
  updateSettings: (settings: Partial<Settings>) => void
}

export const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined
)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [settings, setSettings] = useState<Settings>({})

  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    // Save them and setSettings then
  }, [])

  useEffect(() => {
    console.warn('Get default settings...')
    setSettings({ url: 'http://localhost:3000', domain: 'localhost:3000' })
    setIsLoading(false)
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}
