import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { createLncurlWallet, DEFAULT_LNCURL_SERVER } from '@/lib/lncurl'
import type { Prisma, RemoteWallet } from '@/lib/generated/prisma'

const DEFAULT_WALLET_NAME = 'LNCurl wallet'

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
