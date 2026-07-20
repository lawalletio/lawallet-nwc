import { getSettings } from '@/lib/settings'
import { resolveAccountByPubkey } from './account'
import { Role } from './permissions'

/**
 * Resolves the role for an authenticated pubkey.
 * Any of an account's linked pubkeys (primary or secondary NostrIdentity)
 * resolves to the account's role; falls back to the legacy Settings `root`
 * value so a freshly-bootstrapped instance still recognises its admin
 * before any User row exists.
 *
 * @param pubkey - Hex-encoded Nostr pubkey of the authenticated actor.
 * @returns The resolved role, defaulting to {@link Role.USER} when nothing matches.
 */
export async function resolveRole(pubkey: string): Promise<Role> {
  const account = await resolveAccountByPubkey(pubkey)

  if (account?.role && account.role !== 'USER') {
    return account.role as Role
  }

  // Backwards compatibility: check if pubkey is the root in Settings
  const settings = await getSettings(['root'])
  if (pubkey === settings.root) {
    return Role.ADMIN
  }

  return (account?.role as Role) ?? Role.USER
}
