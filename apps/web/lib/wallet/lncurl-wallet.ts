import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { createLncurlWallet, DEFAULT_LNCURL_SERVER } from '@/lib/lncurl'
import type {
  LightningAddressMode,
  Prisma,
  RemoteWallet,
  RemoteWalletStatus,
} from '@/lib/generated/prisma'

const DEFAULT_WALLET_NAME = 'LNCurl wallet'

/** Settings that gate the LUD-16 lazy LNCurl provisioning / self-heal. */
export interface LncurlAutoHealSettings {
  lncurl_enabled?: string | null
  /** Auto-provision a wallet the first time an address needs one. */
  lncurl_auto_create?: string | null
  /** Re-provision a wallet that died. */
  lncurl_auto_recreate?: string | null
}

/** Minimal RemoteWallet shape the self-heal decision needs. */
export interface LncurlHealWalletRef {
  id: string
  status: RemoteWalletStatus
  /** RemoteWallet.config JSON — only `provider` is read here. */
  config: unknown
}

/**
 * Decide whether a Lightning address whose wallet route resolved to
 * `unconfigured` can be self-healed by provisioning a fresh LNCurl wallet on
 * demand — and, if so, which prior wallet (if any) the heal should replace.
 *
 * Returns `null` when the address is NOT eligible. Otherwise `{ previousWalletId }`:
 *   - `null`   → the address has no wallet at all → provision a fresh one.
 *   - a string → a DEAD LNCurl wallet to recreate (re-point bindings + tombstone).
 *
 * Eligibility:
 *   - `lncurl_enabled` is `'true'`, AND at least one of `lncurl_auto_create` /
 *     `lncurl_auto_recreate` is on,
 *   - the address routes through a wallet (DEFAULT_NWC / CUSTOM_NWC) — never
 *     IDLE (intentionally disabled) or ALIAS (forwards elsewhere),
 *   - then, by case:
 *       · **no wallet at all** → provision a fresh one when EITHER
 *         `lncurl_auto_create` or `lncurl_auto_recreate` is on (both mean
 *         "give this address a wallet on demand").
 *       · **a DEAD LNCurl wallet** → recreate it only when `lncurl_auto_recreate`
 *         is on (recreating dead wallets is specifically that flag's job).
 *       · anything else (DISABLED/REVOKED, or a non-LNCurl provider) is left
 *         untouched — we never silently swap out a user's own wallet.
 *
 * Pure: callers (the LUD-16 metadata + callback routes) decide what to do with
 * the verdict, so the read-only metadata route can serve a callback without
 * provisioning while the callback route actually mints the wallet.
 */
export function lncurlHealTarget(
  args: {
    mode: LightningAddressMode
    /** Wallet bound directly to the address (CUSTOM_NWC). */
    boundWallet: LncurlHealWalletRef | null
    /** The user's default wallet (DEFAULT_NWC). */
    defaultWallet: LncurlHealWalletRef | null
  },
  settings: LncurlAutoHealSettings,
): { previousWalletId: string | null } | null {
  if (settings.lncurl_enabled !== 'true') return null
  const autoCreate = settings.lncurl_auto_create === 'true'
  const autoRecreate = settings.lncurl_auto_recreate === 'true'
  if (!autoCreate && !autoRecreate) return null

  let relevant: LncurlHealWalletRef | null
  if (args.mode === 'DEFAULT_NWC') relevant = args.defaultWallet
  else if (args.mode === 'CUSTOM_NWC') relevant = args.boundWallet
  else return null // IDLE / ALIAS never auto-heal

  // No wallet at all → first-time provisioning. Either flag enables it.
  if (!relevant) return { previousWalletId: null }

  // An existing wallet only gets auto-recreated when it's a DEAD disposable
  // LNCurl wallet AND recreation is enabled. Anything else (DISABLED/REVOKED,
  // or a non-LNCurl provider) is deliberately left alone.
  const isLncurl =
    (relevant.config as { provider?: string } | null)?.provider === 'lncurl'
  if (autoRecreate && relevant.status === 'DEAD' && isLncurl) {
    return { previousWalletId: relevant.id }
  }
  return null
}

export interface CreateLncurlRemoteWalletInput {
  /** Owner of the new wallet. */
  userId: string
  /** Display name; defaults to a unique "LNCurl wallet" variant. */
  name?: string
  /**
   * When provided, the address/card bindings pointing at this (presumably dead)
   * wallet are re-pointed at the freshly minted replacement.
   */
  previousWalletId?: string
  /**
   * When re-provisioning a dead disposable wallet, archive the previous one as
   * DEAD (status `DEAD` + `diedAt`) so it becomes a read-only tombstone the
   * user can inspect or permanently remove — instead of leaving it ACTIVE.
   * Manual creation passes false (the old wallet stays ACTIVE, just unbound).
   */
  revokePrevious?: boolean
  /** Override the LNCurl origin (defaults to the library default). */
  serverUrl?: string
}

/**
 * Pick a name that doesn't collide with the user's existing wallet names.
 * Mirrors the partial unique index `(userId, name)`: starts from the requested
 * (or default) name and appends ` 2`, ` 3`, … until free.
 */
function uniqueName(requested: string, taken: Set<string>): string {
  if (!taken.has(requested)) return requested
  let n = 2
  while (taken.has(`${requested} ${n}`)) n++
  return `${requested} ${n}`
}

/**
 * Provision a fresh LNCurl custodial wallet and persist it as the user's new
 * default {@link RemoteWallet}.
 *
 * The whole DB write runs in a single transaction:
 *   1. demote the user's current default,
 *   2. create the new wallet (default, ACTIVE, tagged `provider: 'lncurl'`),
 *   3. when re-provisioning, re-point the bindings (LightningAddress + Card)
 *      that referenced `previousWalletId` at the new wallet, and optionally
 *      archive the previous wallet as DEAD (status DEAD + `diedAt`).
 */
export async function createLncurlRemoteWallet(
  input: CreateLncurlRemoteWalletInput,
): Promise<RemoteWallet> {
  const { userId, previousWalletId, revokePrevious, serverUrl } = input

  // Mint OUTSIDE the transaction — it's a network call and we don't want to
  // hold a DB transaction open while we wait on LNCurl.
  const { connectionString, mode } = await createLncurlWallet(serverUrl)

  return prisma.$transaction(async tx => {
    // Resolve a collision-free name within the user's namespace.
    const existing = await tx.remoteWallet.findMany({
      where: { userId },
      select: { name: true },
    })
    const taken = new Set(existing.map(w => w.name))
    const name = uniqueName(input.name ?? DEFAULT_WALLET_NAME, taken)

    // Demote the current default so the partial unique index doesn't fire.
    await tx.remoteWallet.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    })

    const config: Prisma.InputJsonValue = {
      connectionString,
      mode,
      provider: 'lncurl',
      // Always record the exact server that minted this wallet — the operator's
      // default can change later, so the wallet must remember its own origin
      // (used by the detail-page "LNCurl" badge link).
      lncurlServerUrl: serverUrl?.trim() || DEFAULT_LNCURL_SERVER,
    }

    const created = await tx.remoteWallet.create({
      data: {
        userId,
        name,
        type: 'NWC',
        config,
        status: 'ACTIVE',
        isDefault: true,
      },
    })

    if (previousWalletId) {
      // Re-point everything that routed through the dead wallet.
      await tx.lightningAddress.updateMany({
        where: { userId, remoteWalletId: previousWalletId },
        data: { remoteWalletId: created.id },
      })
      await tx.card.updateMany({
        where: { userId, remoteWalletId: previousWalletId },
        data: { remoteWalletId: created.id },
      })

      if (revokePrevious) {
        // The disposable wallet was destroyed by the provider — archive it as
        // a DEAD tombstone (read-only, unbindable, removable) rather than
        // REVOKED, so the user can still see its death stats.
        await tx.remoteWallet.updateMany({
          where: { id: previousWalletId, userId },
          data: { status: 'DEAD', diedAt: new Date(), isDefault: false },
        })
      }
    }

    logger.info(
      { userId, walletId: created.id, previousWalletId, revokePrevious },
      'LNCurl wallet provisioned',
    )

    return created
  })
}
