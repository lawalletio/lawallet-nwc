'use client'

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState
} from 'react'
import { getPublicKeyFromPrivate } from '@/lib/nostr'
import { nip19 } from 'nostr-tools'

interface APIResponse<T = any> {
  data?: T
  error?: string
  status: number
}

interface APIContextType {
  get: <T = any>(url: string) => Promise<APIResponse<T>>
  post: <T = any>(url: string, data?: any) => Promise<APIResponse<T>>
  put: <T = any>(url: string, data?: any) => Promise<APIResponse<T>>
  delete: <T = any>(url: string) => Promise<APIResponse<T>>
  privateKey: string | null
  publicKey: string | null
  npub: string | null
  setPrivateKey: (key: string) => void
  isKeyInitialized: boolean
  isHydrated: boolean
}

const APIContext = createContext<APIContextType | undefined>(undefined)

export function APIProvider({ children }: { children: React.ReactNode }) {
  const [privateKey, setPrivateKeyState] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)

  // Load private key from localStorage on mount
  useEffect(() => {
    const savedApiData = localStorage.getItem('api')
    if (savedApiData) {
      try {
        const parsed = JSON.parse(savedApiData)
        setPrivateKeyState(parsed.privateKey || null)
      } catch (error) {
        console.error('Failed to parse saved API data:', error)
      }
    }
    setIsHydrated(true)
  }, [])

  // Save private key to localStorage whenever it changes
  useEffect(() => {
    if (privateKey) {
      localStorage.setItem(
        'api',
        JSON.stringify({
          privateKey
        })
      )
    }
  }, [privateKey])

  const setPrivateKey = useCallback((privateKeyHex: string) => {
    try {
      // Validate the private key by deriving public key
      getPublicKeyFromPrivate(privateKeyHex)
      setPrivateKeyState(privateKeyHex)
    } catch (error) {
      console.error('Failed to set private key:', error)
      throw new Error('Invalid private key')
    }
  }, [])

  // Calculate public key from private key
  const publicKey = React.useMemo(() => {
    if (!privateKey) return null
    try {
      return getPublicKeyFromPrivate(privateKey)
    } catch (e) {
      console.error('Failed to derive public key:', e)
      return null
    }
  }, [privateKey])

  // Calculate npub from public key
  const npub = React.useMemo(() => {
    if (!publicKey) return null
    try {
      return nip19.npubEncode(publicKey)
    } catch (e) {
      console.error('Failed to encode npub:', e)
      return null
    }
  }, [publicKey])

  const makeRequest = useCallback(
    async <T = any,>(
      url: string,
      options: RequestInit = {}
    ): Promise<APIResponse<T>> => {
      try {
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          },
          ...options
        })

        const responseData = await response.json().catch(() => null)

        if (!response.ok) {
          return {
            error:
              responseData?.error ||
              `HTTP ${response.status}: ${response.statusText}`,
            status: response.status
          }
        }

        return {
          data: responseData,
          status: response.status
        }
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : 'Network error',
          status: 0
        }
      }
    },
    []
  )

  const get = useCallback(
    <T = any,>(url: string): Promise<APIResponse<T>> => {
      return makeRequest<T>(url, { method: 'GET' })
    },
    [makeRequest]
  )

  const post = useCallback(
    <T = any,>(url: string, data?: any): Promise<APIResponse<T>> => {
      return makeRequest<T>(url, {
        method: 'POST',
        body: data ? JSON.stringify(data) : undefined
      })
    },
    [makeRequest]
  )

  const put = useCallback(
    <T = any,>(url: string, data?: any): Promise<APIResponse<T>> => {
      return makeRequest<T>(url, {
        method: 'PUT',
        body: data ? JSON.stringify(data) : undefined
      })
    },
    [makeRequest]
  )

  const deleteRequest = useCallback(
    <T = any,>(url: string): Promise<APIResponse<T>> => {
      return makeRequest<T>(url, { method: 'DELETE' })
    },
    [makeRequest]
  )

  const contextValue: APIContextType = {
    get,
    post,
    put,
    delete: deleteRequest,
    privateKey,
    publicKey,
    npub,
    setPrivateKey,
    isKeyInitialized: !!privateKey,
    isHydrated
  }

  return (
    <APIContext.Provider value={contextValue}>{children}</APIContext.Provider>
  )
}

export function useAPI() {
  const context = useContext(APIContext)
  if (context === undefined) {
    throw new Error('useAPI must be used within an APIProvider')
  }
  return context
}
