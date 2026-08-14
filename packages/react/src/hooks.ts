'use client'

import type {
  AddressInvoice,
  CreateRemoteWalletInput,
  CreateWalletAddressInput,
  CurrentUser,
  LaWalletClient,
  PublicInstanceSettings,
  RemoteWallet,
  UpdateWalletAddressInput,
  WalletAddress
} from '@lawallet-nwc/sdk'
import { useCallback, useEffect, useState } from 'react'
import { useLaWalletContext } from './provider'
import { USERNAME_RE } from './use-claim-address'
import { useResource, type ResourceState } from './use-resource'

/** The configured SDK client and instance endpoint. */
export function useLaWallet(): { client: LaWalletClient; endpoint: string } {
  const { client, endpoint } = useLaWalletContext()
  return { client, endpoint }
}

/**
 * Public instance settings (branding, domain, feature flags) — fetched
 * automatically by the provider, no authentication involved.
 */
export function useInstanceInfo(): {
  settings: PublicInstanceSettings | null
  loading: boolean
  error: Error | null
} {
  const { settings, settingsLoading, settingsError } = useLaWalletContext()
  return { settings, loading: settingsLoading, error: settingsError }
}

/** Whether the provider's SSE stream is currently connected. */
export function useSSEConnected(): boolean {
  return useLaWalletContext().sseConnected
}

/**
 * The current user. The first authenticated fetch materialises the account —
 * this hook IS "sign up" for a fresh npub. Pauses while unauthenticated.
 */
export function useUser(): ResourceState<CurrentUser> & {
  user: CurrentUser | null
} {
  const { client, auth } = useLaWalletContext()
  const state = useResource<CurrentUser>(
    auth.status === 'authenticated' ? '/api/users/me' : null,
    () => client.users.me(),
    ['users:updated', 'addresses:updated']
  )
  return { ...state, user: state.data }
}

/** The user's lightning addresses, live-updated, plus creation. */
export function useAddresses(): ResourceState<WalletAddress[]> & {
  addresses: WalletAddress[] | null
  /** Rethrows `LaWalletError` — check `status === 402` for paid registration. */
  createAddress: (input: CreateWalletAddressInput) => Promise<WalletAddress>
} {
  const { client, auth, store } = useLaWalletContext()
  const state = useResource<WalletAddress[]>(
    auth.status === 'authenticated' ? '/api/wallet/addresses' : null,
    () => client.addresses.list(),
    ['addresses:updated']
  )

  const createAddress = useCallback(
    async (input: CreateWalletAddressInput) => {
      const created = await client.addresses.create(input)
      store.invalidate('/api/wallet/addresses')
      store.invalidate('/api/users/me')
      return created
    },
    [client, store]
  )

  return { ...state, addresses: state.data, createAddress }
}

/** One address plus its routing mutations (alias redirect / NWC binding). */
export function useAddress(
  username: string | null
): ResourceState<WalletAddress> & {
  address: WalletAddress | null
  /** `mode: 'ALIAS'` needs `redirect`; `mode: 'CUSTOM_NWC'` needs `remoteWalletId`. */
  update: (input: UpdateWalletAddressInput) => Promise<WalletAddress>
  remove: () => Promise<void>
  setPrimary: () => Promise<void>
} {
  const { client, auth, store } = useLaWalletContext()
  const key =
    auth.status === 'authenticated' && username
      ? `/api/wallet/addresses/${username}`
      : null
  const state = useResource<WalletAddress>(
    key,
    () => client.addresses.get(username as string),
    ['addresses:updated']
  )

  const invalidate = useCallback(() => {
    store.invalidate('/api/wallet/addresses')
    store.invalidate('/api/users/me')
  }, [store])

  const update = useCallback(
    async (input: UpdateWalletAddressInput) => {
      const updated = await client.addresses.update(username as string, input)
      invalidate()
      return updated
    },
    [client, invalidate, username]
  )

  const remove = useCallback(async () => {
    await client.addresses.remove(username as string)
    invalidate()
  }, [client, invalidate, username])

  const setPrimary = useCallback(async () => {
    await client.addresses.setPrimary(username as string)
    invalidate()
  }, [client, invalidate, username])

  return { ...state, address: state.data, update, remove, setPrimary }
}

/**
 * Debounced availability check against the public endpoint — no auth, safe
 * to run while the visitor types their desired username.
 */
export function useUsernameAvailability(username: string): {
  available: boolean | null
  checking: boolean
  formatError: string | null
} {
  const { client } = useLaWalletContext()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)

  const formatError =
    username.length === 0
      ? null
      : username.length > 16
        ? 'Max 16 characters.'
        : !USERNAME_RE.test(username)
          ? 'Lowercase letters and numbers only.'
          : null

  useEffect(() => {
    if (formatError || !username) {
      setAvailable(null)
      return
    }
    let cancelled = false
    setChecking(true)
    const handle = setTimeout(async () => {
      try {
        const result = await client.addresses.checkAvailability(username)
        if (!cancelled) setAvailable(Boolean(result.available))
      } catch {
        if (!cancelled) setAvailable(null)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [client, formatError, username])

  return { available, checking, formatError }
}

/** Invoices received on one address, refreshed by `invoices:updated` SSE events. */
export function useAddressInvoices(
  username: string | null
): ResourceState<AddressInvoice[]> & { invoices: AddressInvoice[] | null } {
  const { client, auth } = useLaWalletContext()
  const key =
    auth.status === 'authenticated' && username
      ? `/api/wallet/addresses/${username}/invoices`
      : null
  const state = useResource<AddressInvoice[]>(
    key,
    () => client.addresses.invoices(username as string),
    ['invoices:updated']
  )
  return { ...state, invoices: state.data }
}

/** The user's remote wallets (NWC connections) plus lifecycle mutations. */
export function useRemoteWallets(): ResourceState<RemoteWallet[]> & {
  wallets: RemoteWallet[] | null
  create: (input: CreateRemoteWalletInput) => Promise<RemoteWallet>
  createLncurl: (input?: {
    name?: string
    isDefault?: boolean
  }) => Promise<RemoteWallet>
  remove: (id: string) => Promise<void>
  getConnectionString: (id: string) => Promise<string>
  getBalance: (id: string) => Promise<number>
} {
  const { client, auth, store } = useLaWalletContext()
  const state = useResource<RemoteWallet[]>(
    auth.status === 'authenticated' ? '/api/remote-wallets' : null,
    () => client.remoteWallets.list()
  )

  const invalidate = useCallback(
    () => store.invalidate('/api/remote-wallets'),
    [store]
  )

  const create = useCallback(
    async (input: CreateRemoteWalletInput) => {
      const wallet = await client.remoteWallets.create(input)
      invalidate()
      return wallet
    },
    [client, invalidate]
  )

  const createLncurl = useCallback(
    async (input?: { name?: string; isDefault?: boolean }) => {
      const wallet = await client.remoteWallets.createLncurl(input)
      invalidate()
      return wallet
    },
    [client, invalidate]
  )

  const remove = useCallback(
    async (id: string) => {
      await client.remoteWallets.remove(id)
      invalidate()
    },
    [client, invalidate]
  )

  const getConnectionString = useCallback(
    (id: string) => client.remoteWallets.connectionString(id),
    [client]
  )

  const getBalance = useCallback(
    (id: string) => client.remoteWallets.balance(id),
    [client]
  )

  return {
    ...state,
    wallets: state.data,
    create,
    createLncurl,
    remove,
    getConnectionString,
    getBalance
  }
}
