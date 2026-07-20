import { prisma } from '@/lib/prisma'
import type { UserRole } from '@/lib/generated/prisma'

/**
 * The account a pubkey resolves to. `primaryPubkey` is the account's public
 * identity (the `isPrimary` NostrIdentity, mirrored on `User.pubkey`);
 * `authPubkey` is the pubkey that actually authenticated — they differ when
 * a secondary identity signed the request.
 */
export interface ResolvedAccount {
  id: string
  primaryPubkey: string
  authPubkey: string
  role: UserRole
}

/**
 * Resolves ANY of an account's linked pubkeys to the owning account.
 *
 * This is the multi-pubkey seam: routes that used to look the User up with
 * `where: { pubkey }` (which only matched the primary) go through here so a
 * session authenticated with a secondary identity reaches the same account.
 * Falls back to `User.pubkey` for robustness (e.g. a row created before the
 * NostrIdentity backfill ran in the same deploy).
 */
export async function resolveAccountByPubkey(
  pubkey: string
): Promise<ResolvedAccount | null> {
  const identity = await prisma.nostrIdentity.findUnique({
    where: { pubkey },
    select: {
      user: { select: { id: true, pubkey: true, role: true } }
    }
  })

  const user =
    identity?.user ??
    (await prisma.user.findUnique({
      where: { pubkey },
      select: { id: true, pubkey: true, role: true }
    }))

  if (!user) return null

  return {
    id: user.id,
    primaryPubkey: user.pubkey,
    authPubkey: pubkey,
    role: user.role
  }
}

/**
 * Convenience wrapper for routes that only need the account id (the common
 * `resolveUserId` shape used across wallet routes). Null when the pubkey is
 * not linked to any account.
 */
export async function resolveAccountId(pubkey: string): Promise<string | null> {
  const account = await resolveAccountByPubkey(pubkey)
  return account?.id ?? null
}
