import type { Prisma } from '@/lib/generated/prisma'

type Tx = Prisma.TransactionClient

/**
 * Renames the incoming wallets that would collide with the target's under
 * `@@unique([userId, name])`. `taken` is seeded with BOTH sides' names so a
 * generated suffix can't collide with another incoming wallet either.
 */
export async function reconcileWalletNames(
  tx: Tx,
  targetId: string,
  incoming: { id: string; name: string }[]
): Promise<void> {
  const targetWallets = await tx.remoteWallet.findMany({
    where: { userId: targetId },
    select: { name: true }
  })
  const targetNames = new Set(targetWallets.map(w => w.name))
  const taken = new Set([...targetNames, ...incoming.map(w => w.name)])

  for (const wallet of incoming) {
    if (!targetNames.has(wallet.name)) continue
    let candidate: string
    for (let i = 2; ; i++) {
      candidate = `${wallet.name} (${i})`
      if (!taken.has(candidate)) break
    }
    taken.add(candidate)
    await tx.remoteWallet.update({
      where: { id: wallet.id },
      data: { name: candidate }
    })
  }
}

export interface ReparentParams {
  fromId: string
  toId: string
  /** The receiving account's flag holders, read inside the same transaction. */
  target: { hasPrimaryAddress: boolean; hasDefaultWallet: boolean }
  /** The moving account's state, read inside the same transaction. */
  incoming: {
    hasPrimaryAddress: boolean
    wallets: { id: string; name: string }[]
  }
}

export interface ReparentResult {
  movedAddresses: number
  movedWallets: number
}

/**
 * Re-parents every resource account `fromId` owns onto `toId`: addresses,
 * wallets and their history, cards, designs, invoices, vouchers, activation
 * bonuses and the activity log. Shared by account merge and card recovery.
 *
 * Login material is deliberately NOT touched — identities, passkeys, the
 * managed key, OAuth grants and the User row stay put. Merge moves them
 * itself (then deletes the shell); recovery leaves them so the old login
 * still resolves to its now-empty account and can see the transfer notice.
 *
 * Partial-unique flags are cleared before the move: the target keeps its
 * primary address, and the default wallet follows whichever primary address
 * wins (the primary wallet derives from the primary address's binding) — so
 * the incoming default survives only when the incoming primary does, or
 * when neither side has a primary and the target has no default. A MASTER
 * clash demotes the incoming card.
 */
export async function reparentAccountResources(
  tx: Tx,
  { fromId, toId, target, incoming }: ReparentParams
): Promise<ReparentResult> {
  if (target.hasPrimaryAddress) {
    await tx.lightningAddress.updateMany({
      where: { userId: fromId, isPrimary: true },
      data: { isPrimary: false }
    })
  }
  // The default wallet follows whichever primary address wins; with no
  // primary on either side the target's default (if any) wins.
  const incomingPrimaryWins =
    !target.hasPrimaryAddress && incoming.hasPrimaryAddress
  if (incomingPrimaryWins) {
    if (target.hasDefaultWallet) {
      await tx.remoteWallet.updateMany({
        where: { userId: toId, isDefault: true },
        data: { isDefault: false }
      })
    }
  } else if (target.hasPrimaryAddress || target.hasDefaultWallet) {
    await tx.remoteWallet.updateMany({
      where: { userId: fromId, isDefault: true },
      data: { isDefault: false }
    })
  }

  // At most one MASTER per holder (`Card_userId_master_unique`).
  const targetMaster = await tx.card.findFirst({
    where: { userId: toId, kind: 'MASTER' },
    select: { id: true }
  })
  if (targetMaster) {
    await tx.card.updateMany({
      where: { userId: fromId, kind: 'MASTER' },
      data: { kind: 'SIMPLE' }
    })
  }

  await reconcileWalletNames(tx, toId, incoming.wallets)

  const [addresses, wallets] = await Promise.all([
    tx.lightningAddress.updateMany({
      where: { userId: fromId },
      data: { userId: toId }
    }),
    tx.remoteWallet.updateMany({
      where: { userId: fromId },
      data: { userId: toId }
    })
  ])
  await tx.card.updateMany({
    where: { userId: fromId },
    data: { userId: toId }
  })
  await tx.ntag424.updateMany({
    where: { userId: fromId },
    data: { userId: toId }
  })
  await tx.cardDesign.updateMany({
    where: { userId: fromId },
    data: { userId: toId }
  })
  await tx.invoice.updateMany({
    where: { userId: fromId },
    data: { userId: toId }
  })
  // Audit history follows the receiving account instead of being nulled.
  await tx.activityLog.updateMany({
    where: { userId: fromId },
    data: { userId: toId }
  })
  // Vouchers are bearer value and their transfer journal is the only
  // recovery path for a half-finished swap. Both cascade on User delete.
  await tx.voucher.updateMany({
    where: { userId: fromId },
    data: { userId: toId }
  })
  await tx.voucherTransfer.updateMany({
    where: { userId: fromId },
    data: { userId: toId }
  })
  // Wallet history: forwarding receipts (with their legs/attempts) and
  // notification deliveries cascade on User delete, so they must travel
  // with the wallets they describe.
  await tx.remoteWalletForwardReceipt.updateMany({
    where: { userId: fromId },
    data: { userId: toId }
  })
  await tx.remoteWalletNotificationDelivery.updateMany({
    where: { userId: fromId },
    data: { userId: toId }
  })
  // FREE_ADDRESS is once per account: the record moves so a recovered or
  // merged account can't redeem the bonus a second time.
  await tx.cardActivationBonus.updateMany({
    where: { userId: fromId },
    data: { userId: toId }
  })
  // Private transaction tags annotate the invoices that just moved, so they
  // travel too. Their PK is composite with the account, so updateMany would
  // collide when both accounts annotated the same payment: insert with
  // skipDuplicates (the target's tag wins) and drop the source rows.
  const movingLabels = await tx.transactionLabel.findMany({
    where: { userId: fromId },
    select: { paymentHash: true, label: true }
  })
  if (movingLabels.length > 0) {
    await tx.transactionLabel.createMany({
      data: movingLabels.map(label => ({ ...label, userId: toId })),
      skipDuplicates: true
    })
    await tx.transactionLabel.deleteMany({ where: { userId: fromId } })
  }

  return {
    movedAddresses: addresses.count,
    movedWallets: wallets.count
  }
}
