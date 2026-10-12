import { prisma } from '@/lib/prisma'
import type { UserRole } from '@/lib/generated/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { NotFoundError } from '@/types/server/errors'
import { getRequestScope } from '@/lib/request-context'

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
export function resolveAccountByPubkey(
  pubkey: string
): Promise<ResolvedAccount | null> {
  // Per-request memo: `authenticate()` (via `resolveRole`) and the route body
  // both resolve the same pubkey, so without this every authenticated request
  // ran the lookup twice. React `cache()` can't do this — it is a passthrough
  // in Route Handlers (no render dispatcher) — so the memo hangs off the
  // request's AsyncLocalStorage frame and dies with it.
  const scope = getRequestScope()
  if (!scope) return lookupAccount(pubkey)

  let memo = accountMemo.get(scope)
  if (!memo) accountMemo.set(scope, (memo = new Map()))
  const cached = memo.get(pubkey)
  if (cached) return cached

  const pending = lookupAccount(pubkey).then(
    account => {
      // Never memoize a miss: signup/claim flows resolve, create the user,
      // and may resolve again in the same request.
      if (!account) memo.delete(pubkey)
      return account
    },
    error => {
      memo.delete(pubkey)
      throw error
    }
  )
  memo.set(pubkey, pending)
  return pending
}

const accountMemo = new WeakMap<
  object,
  Map<string, Promise<ResolvedAccount | null>>
>()

/**
 * Drops the current request's memoized lookups. Call after any write that
 * changes which account a pubkey resolves to (link, unlink, merge, primary
 * switch) so a later lookup in the same request reads the new state.
 */
export function forgetResolvedAccounts(): void {
  const scope = getRequestScope()
  if (scope) accountMemo.delete(scope)
}

async function lookupAccount(pubkey: string): Promise<ResolvedAccount | null> {
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

/**
 * Authenticate a request and resolve it to an owning account id. Owner-scoped
 * routes all need exactly this, and answering 404 (not 403) keeps them from
 * confirming that a resource exists to someone who cannot see it.
 */
export async function requireUserId(request: Request): Promise<string> {
  const auth = await authenticate(request)
  const userId = await resolveAccountId(auth.pubkey)
  if (!userId) throw new NotFoundError('User not found')
  return userId
}
