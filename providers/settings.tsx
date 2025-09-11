'use client'

import {
  createContext,
  ReactNode,
  useCallback,
  useState,
  useEffect
} from 'react'
import { useAPI } from './api'

export interface Settings {
  domain?: string
  endpoint?: string
  is_community?: string
  community_name?: string
  alby_auto_generate?: string
  alby_api_url?: string
  alby_bearer_token?: string
  root?: string
  [key: string]: string | undefined
}

export interface SettingsContextType {
  settings: Settings
  updateSettings: (settings: Partial<Settings>) => Promise<void>
  loadSettings: () => Promise<void>
  isLoading: boolean
  isUpdating: boolean
  error: string | null
  clearError: () => void
}

export const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined
)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState<boolean>(true) // Start with loading true for initial load
  const [isUpdating, setIsUpdating] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const { signer } = useAPI()
  const [settings, setSettings] = useState<Settings>({
    domain: 'localhost:9877',
    endpoint: 'http://localhost:9877'
  })

  // Track if component is mounted to prevent state updates after unmount
  const { get, post } = useAPI()

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const loadSettings = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await get<Settings>('/api/settings')

      if (response.error) {
        throw new Error(response.error)
      }

      const data = response.data!

      // Merge with defaults, preserving environment variables as fallbacks
      setSettings(prevSettings => ({
        domain: data.domain || prevSettings.domain,
        endpoint: data.endpoint || prevSettings.endpoint,
        ...data
      }))
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to load settings'
      setError(errorMessage)
      console.error('Error loading settings:', err)
    } finally {
      setIsLoading(false)
    }
  }, [get])

  const updateSettings = useCallback(
    async (newSettings: Partial<Settings>) => {
      setIsUpdating(true)
      setError(null)

      // Store previous settings for rollback on error
      const previousSettings = settings

      try {
        // Optimistic update - update UI immediately
        setSettings(prevSettings => ({
          ...prevSettings,
          ...newSettings
        }))

        const response = await post('/api/settings', newSettings)

        if (response.error) {
          throw new Error(response.error)
        }

        // Success - the optimistic update was correct
        console.log('Settings updated successfully:', response.data)
      } catch (err) {
        // Rollback optimistic update on error
        setSettings(previousSettings)

        const errorMessage =
          err instanceof Error ? err.message : 'Failed to update settings'
        setError(errorMessage)
        console.error('Error updating settings:', err)

        // Re-throw error so calling code can handle it
        throw err
      } finally {
        setIsUpdating(false)
      }
    },
    [settings, post]
  )

  // Load settings on mount
  useEffect(() => {
    if (signer) {
      loadSettings()
    }
  }, [loadSettings, signer])

  return (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings,
        loadSettings,
        isLoading,
        isUpdating,
        error,
        clearError
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}
