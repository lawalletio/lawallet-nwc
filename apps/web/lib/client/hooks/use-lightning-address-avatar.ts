'use client'

import { useEffect, useState } from 'react'
import { readAvatar, writeAvatar } from '@/lib/client/cache/avatar-cache'
import { resolveNip05Profile } from '@/lib/client/contacts-store'
import { isLightningAddress } from '@/lib/ln-address'

export interface LightningAddressAvatar {
  avatarUrl: string | null
  name: string | null
  loading: boolean
}

const EMPTY: LightningAddressAvatar = {
  avatarUrl: null,
  name: null,
  loading: false
}

/** In-flight lookups, shared across every mounted input in the tab. */
const inflight = new Map<string, Promise<void>>()

/**
 * Resolves the real profile behind ONE lightning address — the one the user
 * finished typing, never the generated candidates, which keep their domain
 * logo. A NIP-05 lookup plus a relay query per candidate would be fourteen
 * round-trips a keystroke, almost all of them for addresses that don't exist.
 *
 * Reads the cache synchronously so a known address paints on first render.
 */
export function useLightningAddressAvatar(
  address: string | null
): LightningAddressAvatar {
  const normalized = address?.trim().toLowerCase() ?? ''
  const enabled = Boolean(normalized) && isLightningAddress(normalized)

  const [state, setState] = useState<LightningAddressAvatar>(() => {
    if (!enabled) return EMPTY
    const cached = readAvatar(normalized)
    return cached
      ? { avatarUrl: cached.avatarUrl, name: cached.name, loading: false }
      : EMPTY
  })

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY)
      return
    }

    const cached = readAvatar(normalized)
    if (cached) {
      setState({
        avatarUrl: cached.avatarUrl,
        name: cached.name,
        loading: false
      })
      return
    }

    let active = true
    setState({ avatarUrl: null, name: null, loading: true })

    const pending =
      inflight.get(normalized) ??
      resolveNip05Profile(normalized)
        .then(profile => {
          // A miss is cached too: most typed addresses never resolve, and
          // re-asking on every remount is the expensive case, not the hit.
          writeAvatar(normalized, {
            avatarUrl: profile?.avatarUrl ?? null,
            name: profile?.displayName ?? profile?.name ?? null
          })
        })
        .catch(() => {
          writeAvatar(normalized, { avatarUrl: null, name: null })
        })
        .finally(() => {
          inflight.delete(normalized)
        })
    inflight.set(normalized, pending)

    void pending.then(() => {
      if (!active) return
      const resolved = readAvatar(normalized)
      setState({
        avatarUrl: resolved?.avatarUrl ?? null,
        name: resolved?.name ?? null,
        loading: false
      })
    })

    return () => {
      active = false
    }
  }, [enabled, normalized])

  return state
}
