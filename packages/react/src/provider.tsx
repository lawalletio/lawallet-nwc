'use client'

import {
  LaWalletClient,
  browserSigner,
  hasBrowserExtension,
  nsecSigner,
  toNpub,
  type EventSourceConstructor,
  type NostrSigner,
  type PublicInstanceSettings,
  type SSEEventType
} from '@lawallet-nwc/sdk'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { ResourceStore } from './store'

export type LoginMethod = 'nsec' | 'extension' | 'generated' | 'signer'

export type AuthStatus = 'unauthenticated' | 'authenticated'

export interface AuthState {
  status: AuthStatus
  pubkey: string | null
  npub: string | null
  method: LoginMethod | null
  error: Error | null
  loginWithExtension: () => Promise<void>
  /** `remember` persists the key in localStorage — warn users about custody. */
  loginWithNsec: (nsec: string, opts?: { remember?: boolean }) => Promise<void>
  /** Generates a fresh identity; show the returned nsec ONCE for backup. */
  loginWithNewKey: (opts?: {
    remember?: boolean
  }) => Promise<{ nsec: string; npub: string }>
  /** Any structural NostrSigner (NIP-46 bunker, NDK, custom). Never persisted. */
  loginWithSigner: (signer: NostrSigner) => Promise<void>
  logout: () => void
}

export interface LaWalletContextValue {
  client: LaWalletClient
  endpoint: string
  settings: PublicInstanceSettings | null
  settingsLoading: boolean
  settingsError: Error | null
  auth: AuthState
  store: ResourceStore
  /** Per-event-type counters bumped by SSE — hooks depend on them to refetch. */
  sseVersions: Partial<Record<SSEEventType, number>>
  sseConnected: boolean
}

const LaWalletContext = createContext<LaWalletContextValue | null>(null)

const NSEC_KEY = 'lawallet:nsec'
const METHOD_KEY = 'lawallet:login-method'

const storageArea = (enabled: boolean): Storage | null =>
  enabled && typeof window !== 'undefined' ? window.localStorage : null

export interface LaWalletProviderProps {
  /** Public origin of the LaWallet instance, e.g. `https://wallet.example.com`. */
  endpoint: string
  /**
   * `'local'` (default) remembers the login across reloads — the nsec is only
   * stored when a login is called with `remember: true`. `'none'` keeps
   * everything in memory.
   */
  storage?: 'local' | 'none'
  /** EventSource injection for tests/unsupported environments. */
  EventSourceImpl?: EventSourceConstructor
  children: ReactNode
}

/**
 * Wraps an app with a configured {@link LaWalletClient}: fetches the public
 * instance settings (branding, domain, feature flags) automatically, restores
 * a remembered login, and keeps one SSE subscription alive that invalidates
 * the data hooks.
 */
export function LaWalletProvider({
  endpoint,
  storage = 'local',
  EventSourceImpl,
  children
}: LaWalletProviderProps) {
  const clientRef = useRef<LaWalletClient | null>(null)
  if (!clientRef.current) {
    clientRef.current = new LaWalletClient({ endpoint, EventSourceImpl })
  }
  const client = clientRef.current
  const storeRef = useRef<ResourceStore | null>(null)
  if (!storeRef.current) storeRef.current = new ResourceStore()
  const store = storeRef.current

  const [settings, setSettings] = useState<PublicInstanceSettings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsError, setSettingsError] = useState<Error | null>(null)

  const [session, setSession] = useState<{
    pubkey: string | null
    method: LoginMethod | null
  }>({ pubkey: null, method: null })
  const [authError, setAuthError] = useState<Error | null>(null)

  const [sseVersions, setSseVersions] = useState<
    Partial<Record<SSEEventType, number>>
  >({})
  const [sseConnected, setSseConnected] = useState(false)

  // Instance discovery — public endpoint, no auth involved.
  useEffect(() => {
    let cancelled = false
    setSettingsLoading(true)
    client.settings
      .get()
      .then(data => {
        if (!cancelled) setSettings(data)
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setSettingsError(
            error instanceof Error ? error : new Error(String(error))
          )
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client])

  const applySigner = useCallback(
    async (signer: NostrSigner, method: LoginMethod) => {
      setAuthError(null)
      const pubkey = await signer.getPublicKey()
      client.setSigner(signer)
      store.clear()
      setSession({ pubkey, method })
      const area = storageArea(storage === 'local')
      area?.setItem(METHOD_KEY, method)
    },
    [client, store, storage]
  )

  // Restore a remembered login once on mount.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const area = storageArea(storage === 'local')
    if (!area) return
    const method = area.getItem(METHOD_KEY) as LoginMethod | null
    const storedNsec = area.getItem(NSEC_KEY)
    try {
      if (storedNsec) {
        void applySigner(
          nsecSigner(storedNsec),
          method === 'generated' ? 'generated' : 'nsec'
        )
      } else if (method === 'extension' && hasBrowserExtension()) {
        void applySigner(browserSigner(), 'extension')
      }
    } catch {
      // Stored key unreadable or extension gone — start signed out.
      area.removeItem(NSEC_KEY)
      area.removeItem(METHOD_KEY)
    }
  }, [applySigner, storage])

  // One SSE subscription while authenticated; events bump per-type versions.
  useEffect(() => {
    if (!session.pubkey) return
    const unsubscribe = client.events.subscribe(
      type => {
        setSseVersions(versions => ({
          ...versions,
          [type]: (versions[type] ?? 0) + 1
        }))
      },
      {
        onStatus: status => setSseConnected(status === 'open')
      }
    )
    return () => {
      unsubscribe()
      setSseConnected(false)
    }
  }, [client, session.pubkey])

  const wrapLogin = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn()
      } catch (error) {
        setAuthError(error instanceof Error ? error : new Error(String(error)))
        throw error
      }
    },
    [setAuthError]
  )

  const auth = useMemo<AuthState>(() => {
    const rememberNsec = (nsec: string, remember?: boolean) => {
      if (remember) storageArea(storage === 'local')?.setItem(NSEC_KEY, nsec)
    }

    return {
      status: session.pubkey ? 'authenticated' : 'unauthenticated',
      pubkey: session.pubkey,
      npub: session.pubkey ? toNpub(session.pubkey) : null,
      method: session.method,
      error: authError,

      loginWithExtension: () =>
        wrapLogin(() => applySigner(browserSigner(), 'extension')),

      loginWithNsec: (nsec, opts) =>
        wrapLogin(async () => {
          await applySigner(nsecSigner(nsec), 'nsec')
          rememberNsec(nsec, opts?.remember)
        }),

      loginWithNewKey: async opts => {
        const { generateSigner } = await import('@lawallet-nwc/sdk')
        const generated = generateSigner()
        await wrapLogin(async () => {
          await applySigner(generated.signer, 'generated')
          rememberNsec(generated.nsec, opts?.remember)
        })
        return { nsec: generated.nsec, npub: generated.npub }
      },

      loginWithSigner: signer => wrapLogin(() => applySigner(signer, 'signer')),

      logout: () => {
        client.setSigner(null)
        store.clear()
        setSession({ pubkey: null, method: null })
        setAuthError(null)
        const area = storageArea(storage === 'local')
        area?.removeItem(NSEC_KEY)
        area?.removeItem(METHOD_KEY)
      }
    }
  }, [applySigner, authError, client, session, storage, store, wrapLogin])

  const value = useMemo<LaWalletContextValue>(
    () => ({
      client,
      endpoint: client.endpoint,
      settings,
      settingsLoading,
      settingsError,
      auth,
      store,
      sseVersions,
      sseConnected
    }),
    [
      auth,
      client,
      settings,
      settingsError,
      settingsLoading,
      sseConnected,
      sseVersions,
      store
    ]
  )

  return (
    <LaWalletContext.Provider value={value}>
      {children}
    </LaWalletContext.Provider>
  )
}

export function useLaWalletContext(): LaWalletContextValue {
  const context = useContext(LaWalletContext)
  if (!context) {
    throw new Error('LaWallet hooks must be used inside <LaWalletProvider>')
  }
  return context
}
