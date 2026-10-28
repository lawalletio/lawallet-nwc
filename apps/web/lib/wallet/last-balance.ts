import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { driverForWallet } from '@/lib/wallet/drivers'
import type { Prisma, RemoteWalletType } from '@/lib/generated/prisma'

/**
 * A wallet whose last balance reading was above this many sats is never
 * archived or replaced automatically — silence is not proof the funds are
 * gone. Only its owner can retire it.
 */
export const ARCHIVE_PROTECTED_BALANCE_SATS = 5

/**
 * True when the wallet may still hold more than
 * {@link ARCHIVE_PROTECTED_BALANCE_SATS}: its last balance reading, plus every
 * payment it received since that reading (all of them, if it was never read).
 * Counting receipts covers gifted wallets whose holder never opened the app,
 * so no balance was ever read. Spends are not subtracted — over-protecting
 * costs a stale row, under-protecting costs someone's sats.
 */
export async function holdsProtectedBalance(
  wallet: {
    id: string
    lastBalanceSats: number | null
    lastBalanceAt: Date | null
  },
  db: Prisma.TransactionClient = prisma
): Promise<boolean> {
  const last = wallet.lastBalanceSats ?? 0
  if (last > ARCHIVE_PROTECTED_BALANCE_SATS) return true
  const received = await db.invoice.aggregate({
    where: {
      remoteWalletId: wallet.id,
      status: 'PAID',
      ...(wallet.lastBalanceAt ? { paidAt: { gt: wallet.lastBalanceAt } } : {})
    },
    _sum: { amountSats: true }
  })
  return last + (received._sum.amountSats ?? 0) > ARCHIVE_PROTECTED_BALANCE_SATS
}

/**
 * Read a wallet's live balance through its driver and remember it, so a later
 * automatic archive can see what the wallet held. Driver errors propagate.
 */
export async function readWalletBalance(wallet: {
  id: string
  type: RemoteWalletType
  config: unknown
}): Promise<number> {
  const { driver, config } = driverForWallet(wallet)
  const { balanceSats } = await driver.getBalance(config)
  await recordWalletBalance(wallet.id, balanceSats)
  return balanceSats
}

/**
 * Raw SQL so `updatedAt` stays put — together with the trigger's WHEN clause
 * that keeps balance polls from waking the listener's reconcile. Best effort:
 * a failed write never fails the balance read.
 */
export async function recordWalletBalance(
  walletId: string,
  balanceSats: number
): Promise<void> {
  if (!Number.isSafeInteger(balanceSats) || balanceSats < 0) return
  try {
    await prisma.$executeRaw`
      UPDATE "RemoteWallet"
      SET "lastBalanceSats" = ${balanceSats}, "lastBalanceAt" = NOW()
      WHERE id = ${walletId}
    `
  } catch (err) {
    logger.warn({ err, walletId }, 'wallet.last_balance_write_failed')
  }
}
