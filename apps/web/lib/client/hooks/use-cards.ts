'use client'

import { useMemo } from 'react'
import {
  invalidateApiPath,
  useApi,
  useMutation
} from '@/lib/client/hooks/use-api'

export interface CardData {
  id: string
  /** Human-readable card name (admin-set). Can be null on legacy / orphan rows. */
  title: string | null
  designId: string | null
  design: {
    id: string
    description: string | null
    image: string | null
  } | null
  ntag424: {
    cid: string
    ctr: number
    otc: string | null
  } | null
  /**
   * The card's owner, present once the card is claimed/activated (i.e. it has a
   * `userId`). A card is "paired" iff this is non-null. `username` is the owner's
   * lightning-address local part when they have one — it can be null (a freshly
   * activated user may not have claimed an address yet), so don't gate "paired"
   * on it.
   */
  lightningAddress: {
    username: string | null
    pubkey: string
  } | null
  /** RemoteWallet this card spends from (or null if unbound). */
  remoteWalletId: string | null
  /** The owner's active primary RemoteWallet, when the caller is viewing their own cards. */
  defaultRemoteWalletId: string | null
  /**
   * True once the card's reset (wipe) keys have been exported — it's
   * decommissioned and can only be re-wiped or deleted, never re-used. Takes
   * display precedence over paired/unpaired.
   */
  blocked: boolean
  /** True when the owner has temporarily paused tap-to-pay. */
  disabled: boolean
  createdAt: string
  updatedAt: string
}

export interface CardCounts {
  total: number
  paired: number
  unpaired: number
  used: number
  unused: number
  blocked: number
}

export interface CardFilters {
  paired?: boolean
  used?: boolean
}

// ── API → client transforms ─────────────────────────────────────────────────
// The /api/cards and /api/cards/[id] endpoints emit the legacy `types/card.ts`
// shape (flat `pubkey`/`username`, `design.imageUrl`, card-level `otc`). The
// admin dashboard reads a slightly different shape — `design.image`, a nested
// `lightningAddress`, `ntag424.otc`, a top-level `designId` and `updatedAt`.
// Rather than changing every consumer of the server type, we reshape once here.

interface ApiCardDesign {
  id: string
  description: string | null
  imageUrl: string | null
  createdAt: string
}

interface ApiCardNtag424 {
  cid: string
  ctr: number
  createdAt: string
}

interface ApiCard {
  id: string
  design: ApiCardDesign | null
  ntag424: ApiCardNtag424 | null
  createdAt: string
  title?: string
  lastUsedAt?: string | null
  pubkey?: string
  username?: string
  otc?: string | null
  remoteWalletId?: string | null
  defaultRemoteWalletId?: string | null
  blocked?: boolean
  disabled?: boolean
}

function toCardData(c: ApiCard): CardData {
  return {
    id: c.id,
    title: c.title ?? null,
    designId: c.design?.id ?? null,
    design: c.design
      ? {
          id: c.design.id,
          description: c.design.description,
          image: c.design.imageUrl
        }
      : null,
    ntag424: c.ntag424
      ? {
          cid: c.ntag424.cid,
          ctr: c.ntag424.ctr,
          otc: c.otc ?? null
        }
      : null,
    // Paired === the card has an owner (server sets `userId`, surfaced here as
    // `pubkey`). The lightning-address `username` is optional — a just-activated
    // user may not have claimed one yet, so it must not gate "paired".
    lightningAddress: c.pubkey
      ? { username: c.username ?? null, pubkey: c.pubkey }
      : null,
    remoteWalletId: c.remoteWalletId ?? null,
    defaultRemoteWalletId: c.defaultRemoteWalletId ?? null,
    blocked: c.blocked ?? false,
    disabled: c.disabled ?? false,
    createdAt: c.createdAt,
    // Legacy API has no `updatedAt` — fall back to lastUsedAt/createdAt so
    // the "Last used" column still shows something sensible.
    updatedAt: c.lastUsedAt ?? c.createdAt
  }
}

/**
 * Fetch cards list with optional filters.
 *
 * `/api/cards` is admin-scoped (requires `CARDS_READ`). Pass
 * `{ enabled: false }` to skip the fetch entirely for callers who lack
 * the permission — `useApi(null)` is a no-op, so the hook stays idle
 * and returns `data: null` instead of firing a request that would 403.
 * The Connection Map uses this so plain users can open the page without
 * a forbidden request in their network tab; they simply see no card
 * column.
 */
export function useCards(
  filters?: CardFilters,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled ?? true
  const params = new URLSearchParams()
  if (filters?.paired !== undefined)
    params.set('paired', String(filters.paired))
  if (filters?.used !== undefined) params.set('used', String(filters.used))
  const qs = params.toString()
  const queryParams = qs ? `?${qs}` : ''

  const result = useApi<ApiCard[]>(enabled ? `/api/cards${queryParams}` : null)
  const data = useMemo(
    () => (result.data ? result.data.map(toCardData) : null),
    [result.data]
  )
  return { ...result, data }
}

/**
 * Fetch the *authenticated caller's own* cards — the ones paired to them.
 *
 * Backed by the per-caller `GET /api/wallet/cards`, which ANY authenticated
 * role can read (the admin `/api/cards` needs `CARDS_READ` and returns every
 * card). The Connection Map + the user Cards view use this so a plain user —
 * or an admin — sees exactly the cards paired to themselves, with no
 * client-side pubkey matching that could silently hide a freshly paired card.
 */
export function useMyCards(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true
  const result = useApi<ApiCard[]>(enabled ? '/api/wallet/cards' : null)
  const data = useMemo(
    () => (result.data ? result.data.map(toCardData) : null),
    [result.data]
  )
  return { ...result, data }
}

/**
 * Fetch card counts/stats.
 *
 * `/api/cards/counts` is admin-scoped (`CARDS_READ`). Pass `{ enabled: false }`
 * to skip the fetch for callers without the permission (e.g. the user-facing
 * Cards view, which shows no instance-wide stats) so they don't fire a 403.
 */
export function useCardCounts(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true
  return useApi<CardCounts>(enabled ? '/api/cards/counts' : null)
}

/**
 * Fetch a single card by ID.
 */
export function useCard(id: string | null) {
  const result = useApi<ApiCard>(id ? `/api/cards/${id}` : null)
  const data = useMemo(
    () => (result.data ? toCardData(result.data) : null),
    [result.data]
  )
  return { ...result, data }
}

export interface CardTransaction {
  id: string
  createdAt: string
  /** Amount in sats; null for a zero-amount invoice. */
  amountSats: number | null
  status: 'success' | 'failed'
  /** Failure reason when `status === 'failed'`. */
  error: string | null
  /** Wallet type that settled the spend (e.g. NWC). */
  walletType: string | null
  /** The merchant bolt11 the card paid. */
  bolt11: string | null
  /** Decoded invoice fields for the details view. */
  description: string | null
  paymentHash: string | null
}

/**
 * Fetch a card's spend history (the LNURL-withdraw payments made by tapping it),
 * newest first. Backed by `/api/cards/[id]/transactions`; the `/api/cards`
 * family maps to `cards:updated`, so it auto-refetches when a new tap is paid.
 */
export function useCardTransactions(id: string | null) {
  return useApi<{ items: CardTransaction[] }>(
    id ? `/api/cards/${id}/transactions` : null
  )
}

export interface UpdateCardInput {
  /** New wallet to bind; pass `null` to unbind. */
  remoteWalletId: string | null
}

/**
 * Mutation hook for creating / updating / deleting cards.
 *
 * Each verb uses its own `useMutation` instance so their `loading` /
 * `error` flags don't bleed into each other — a card being PATCHed
 * shouldn't grey out a separate create button.
 */
export function useCardMutations() {
  // TOutput intentionally left loose — the create endpoint returns the
  // legacy `Card` shape from `types/card.ts` (flat pubkey/username etc.);
  // consumers here only need `id` to route to the new card's page.
  const create = useMutation<
    { id: string; designId?: string },
    { id: string }
  >()
  const update = useMutation<UpdateCardInput, ApiCard>()
  const del = useMutation<undefined, { message: string; cardId: string }>()

  return {
    createCard: (data: { id: string; designId?: string }) =>
      create.mutate('post', '/api/cards', data),
    updateCard: (id: string, input: UpdateCardInput) =>
      update.mutate('patch', `/api/cards/${id}`, input),
    deleteCard: (id: string) => del.mutate('del', `/api/cards/${id}`),
    creating: create.loading,
    updating: update.loading,
    deleting: del.loading,
    // Backwards-compatible aggregate flag for existing callers.
    loading: create.loading || update.loading || del.loading,
    error: create.error ?? update.error ?? del.error
  }
}

export function useMyCardMutations() {
  const update = useMutation<
    { enabled: boolean } | { linkDefaultWallet: true },
    ApiCard
  >()

  return {
    setCardEnabled: async (id: string, enabled: boolean) => {
      const result = await update.mutate('patch', `/api/wallet/cards/${id}`, {
        enabled
      })
      invalidateApiPath('/api/wallet/cards')
      return toCardData(result)
    },
    linkCardToDefaultWallet: async (id: string) => {
      const result = await update.mutate('patch', `/api/wallet/cards/${id}`, {
        linkDefaultWallet: true
      })
      invalidateApiPath('/api/wallet/cards')
      return toCardData(result)
    },
    updating: update.loading,
    error: update.error
  }
}
