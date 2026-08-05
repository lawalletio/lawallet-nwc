import { DEV_ADMIN_PUBKEY, DEV_ADMIN_USER_ID } from '@/lib/dev-identity'
import {
  normalizeNostrPubkey,
  type NormalizedNostrPubkey
} from '@/lib/nostr/profile'

export interface AccountNostrIdentity {
  id: string
  pubkey: string
  nostrIdentities?: Array<{ pubkey: string }>
}

/**
 * Resolve the account identity used by both NIP-05 and NIP-57.
 *
 * NostrIdentity is authoritative when present; User.pubkey remains the
 * compatibility fallback for databases created before multiple identities.
 */
export function resolveAccountPubkey(
  user: AccountNostrIdentity
): NormalizedNostrPubkey | null {
  const primary = user.nostrIdentities?.[0]?.pubkey
  const normalized =
    (primary ? normalizeNostrPubkey(primary) : null) ??
    normalizeNostrPubkey(user.pubkey)

  if (normalized) return normalized

  // Older local seeds used an illustrative `npub1xyz...` value that is not
  // valid Bech32. Repair only that known development identity consistently
  // across public NIP-05 lookup and NIP-57 zap validation.
  if (process.env.NODE_ENV === 'development' && user.id === DEV_ADMIN_USER_ID) {
    return normalizeNostrPubkey(DEV_ADMIN_PUBKEY)
  }

  return null
}
