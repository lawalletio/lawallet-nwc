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
import { NSecSigner } from '@nostrify/nostrify'
import { createNip98Token } from '@/lib/nip98'
import { hexToBytes } from 'nostr-tools/utils'

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
  userId: string | null
  setUserId: (userId: string) => void
  isKeyInitialized: boolean
  isHydrated: boolean
  signer: NSecSigner | null
  loginWithPrivateKey: (privateKeyHex: string) => Promise<void>
}

const APIContext = createContext<APIContextType | undefined>(undefined)

export function APIProvider({ children }: { children: React.ReactNode }) {
  const [privateKey, setPrivateKeyState] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [isHydrated, setIsHydrated] = useState(false)
  const [signer, setSigner] = useState<NSecSigner | null>(null)
  const [loginMethod, setLoginMethod] = useState<'nsec' | 'nip07' | null>(null)
  const [publicKey, setPublicKey] = useState<string | null>(null)

  const loginWithPrivateKey = useCallback(
    async (privateKeyHex: string) => {
      try {
        // Validate the private key by deriving public key
        setPublicKey(getPublicKeyFromPrivate(privateKeyHex))
        setPrivateKeyState(privateKeyHex)
        setLoginMethod('nsec')
      } catch (error) {
        console.error('Failed to set private key:', error)
        throw new Error('Invalid private key')
      }
    },
    [setPublicKey, setLoginMethod, setPrivateKeyState]
  )

  // Load private key and userId from localStorage on mount
  useEffect(() => {
    const savedApiData = localStorage.getItem('api')
    if (savedApiData) {
      try {
        const parsed = JSON.parse(savedApiData)
        switch (parsed.method) {
          case 'nsec':
            loginWithPrivateKey(parsed.privateKey)
            break
          // case 'nip07':
          //   setLoginMethod('nip07')
          //   break
        }
        setUserId(parsed.userId || null)
      } catch (error) {
        console.error('Failed to parse saved API data:', error)
      }
    }
    setIsHydrated(true)
  }, [])

  // Save private key and userId to localStorage whenever they change
  useEffect(() => {
    // Only save to localStorage after hydration is complete to avoid overwriting during initial load
    if (isHydrated) {
      localStorage.setItem(
        'api',
        JSON.stringify({
          privateKey,
          userId,
          method: loginMethod
        })
      )
    }
  }, [privateKey, userId, loginMethod, isHydrated])

  // Create signer when private key is set
  useEffect(() => {
    if (privateKey) {
      try {
        // Convert hex string to Uint8Array
        const secretKey = hexToBytes(privateKey)
        const newSigner = new NSecSigner(secretKey)
        setSigner(newSigner)
      } catch (error) {
        console.error('Failed to create signer:', error)
        setSigner(null)
      }
    } else {
      setSigner(null)
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
      options.method
      try {
        const authHeader = signer
          ? await createNip98Token(url, options, signer)
          : undefined

        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
            ...(authHeader ? { Authorization: authHeader } : {})
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
    [signer]
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
    userId,
    setUserId,
    isKeyInitialized: signer !== null,
    isHydrated,
    loginWithPrivateKey,
    signer
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
