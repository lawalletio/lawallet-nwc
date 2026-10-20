import { prisma } from '@/lib/prisma'
import { AuthorizationError, NotFoundError } from '@/types/server/errors'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { forgetResolvedAccounts } from '@/lib/auth/account'

export interface DeleteAccountResult {
  deletedAddresses: number
  deletedWallets: number
  unpairedCards: number
}

/**
 * Permanently deletes account `userId` and everything it owns, in one
 * transaction. Most rows go through the `User` FK cascades (identities,
 * passkeys, managed key, lightning addresses — which frees the usernames —
 * remote wallets and their forwarding/notification config, vouchers, OAuth
 * grants, MCP payments). Rows the cascades don't reach are handled here:
 *
 * - Cards are **unpaired**, not deleted: they're physical inventory. Like
 *   `unpairCard`, holder, address, wallet and MASTER designation are cleared,
 *   and outstanding activation QRs are revoked.
 * - Forwarding receipts are deleted before the wallets: a receipt RESTRICTs
 *   deleting its config revision, and the cascades only clear it first by
 *   trigger firing order.
 * - Plain-column rows (WebAuthn challenges, proxy invoice intents) are swept.
 *
 * Kept with `userId` nulled (FK SetNull): invoices (operator payment ledger;
 * an in-flight proxy payment still settles), activity logs, card designs,
 * NTAG424 keys, card activation bonuses (the per-card one-shot record).
 *
 * Refused (403) for the instance root — its pubkey in Settings would keep
 * granting ADMIN, and clearing it would reopen first-run root assignment —
 * and for the last ADMIN.
 */
export async function deleteAccount(
  userId: string
): Promise<DeleteAccountResult> {
  const result = await prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        pubkey: true,
        nostrIdentities: { select: { pubkey: true } }
      }
    })
    if (!user) throw new NotFoundError('Account not found')

    const pubkeys = new Set([
      user.pubkey,
      ...user.nostrIdentities.map(i => i.pubkey)
    ])
    const root = await tx.settings.findUnique({ where: { name: 'root' } })
    if (root && pubkeys.has(root.value)) {
      throw new AuthorizationError(
        'The instance root account cannot be deleted'
      )
    }

    if (user.role === 'ADMIN') {
      // FOR UPDATE serializes concurrent admin deletions: the loser re-reads
      // after the winner commits and no longer sees the winner's row.
      const admins = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "User" WHERE role = 'ADMIN' FOR UPDATE
      `
      if (!admins.some(a => a.id !== userId)) {
        throw new AuthorizationError('Cannot delete the last admin account')
      }
    }

    await tx.cardActivationToken.updateMany({
      where: { status: 'PENDING', card: { userId } },
      data: { status: 'REVOKED' }
    })
    const cards = await tx.card.updateMany({
      where: { userId },
      data: {
        userId: null,
        username: null,
        remoteWalletId: null,
        kind: 'SIMPLE'
      }
    })

    await tx.remoteWalletForwardReceipt.deleteMany({
      where: { OR: [{ userId }, { wallet: { userId } }] }
    })
    const wallets = await tx.remoteWallet.deleteMany({ where: { userId } })
    const addresses = await tx.lightningAddress.deleteMany({
      where: { userId }
    })

    await tx.webAuthnChallenge.deleteMany({ where: { userId } })
    await tx.proxyInvoiceIntent.deleteMany({ where: { userId } })

    await tx.user.delete({ where: { id: userId } })

    return {
      deletedAddresses: addresses.count,
      deletedWallets: wallets.count,
      unpairedCards: cards.count
    }
  })

  forgetResolvedAccounts()
  // No `userId`: the row is gone and the FK would reject the insert.
  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.ACCOUNT_DELETED,
    level: 'WARN',
    message: `Account ${userId} deleted by its owner`,
    metadata: { deletedUserId: userId, ...result }
  })

  return result
}
