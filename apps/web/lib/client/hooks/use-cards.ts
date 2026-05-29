'use client'

import { useMemo } from 'react'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'

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
    k0: string
    k1: string
    k2: string
    k3: string
    k4: string
    ctr: number
    otc: string | null
  } | null
  lightningAddress: {
    username: string
    pubkey: string
  } | null
  /** RemoteWallet this card spends from (or null if unbound). */
  remoteWalletId: string | null
  createdAt: string
  updatedAt: string
}

export interface CardCounts {
  total: number
  paired: number
  unpaired: number
  used: number
  unused: number
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
  k0: string
  k1: string
  k2: string
  k3: string
  k4: string
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
          image: c.design.imageUrl,
        }
      : null,
    ntag424: c.ntag424
      ? {
          k0: c.ntag424.k0,
          k1: c.ntag424.k1,
          k2: c.ntag424.k2,
          k3: c.ntag424.k3,
          k4: c.ntag424.k4,
          ctr: c.ntag424.ctr,
          otc: c.otc ?? null,
        }
      : null,
    lightningAddress:
      c.username && c.pubkey
        ? { username: c.username, pubkey: c.pubkey }
        : null,
    remoteWalletId: c.remoteWalletId ?? null,
    createdAt: c.createdAt,
    // Legacy API has no `updatedAt` — fall back to lastUsedAt/createdAt so
    // the "Last used" column still shows something sensible.
    updatedAt: c.lastUsedAt ?? c.createdAt,
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
export function useCards(filters?: CardFilters, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true
  const params = new URLSearchParams()
  if (filters?.paired !== undefined) params.set('paired', String(filters.paired))
  if (filters?.used !== undefined) params.set('used', String(filters.used))
  const qs = params.toString()
  const queryParams = qs ? `?${qs}` : ''

  const result = useApi<ApiCard[]>(enabled ? `/api/cards${queryParams}` : null)
  const data = useMemo(
    () => (result.data ? result.data.map(toCardData) : null),
    [result.data],
  )
  return { ...result, data }
}

/**
 * Fetch card counts/stats.
 */
export function useCardCounts() {
  return useApi<CardCounts>('/api/cards/counts')
}

/**
 * Fetch a single card by ID.
 */
export function useCard(id: string | null) {
  const result = useApi<ApiCard>(id ? `/api/cards/${id}` : null)
  const data = useMemo(
    () => (result.data ? toCardData(result.data) : null),
    [result.data],
  )
  return { ...result, data }
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
  const create = useMutation<{ id: string; designId?: string }, { id: string }>()
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
    error: create.error ?? update.error ?? del.error,
  }
}
