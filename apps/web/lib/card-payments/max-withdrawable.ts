import { logger } from '@/lib/logger'
import { driverForWallet } from '@/lib/wallet/drivers'
import type { CardWalletRoute } from '@/lib/wallet/resolve-payment-route'

/**
 * Keep a balance read inside a BoltCard tap budget. With web next to the
 * listener the read is one relay round-trip (p95 ~500 ms); past this, the
 * scan advertises a high ceiling and the callback stops waiting on it.
 */
export const BALANCE_PROBE_MS = 600

/**
 * Advertised only when the wallet balance cannot be read in time. This is not
 * a spend limit: the callback pays any exact invoice the wallet accepts.
 * `Number.MAX_SAFE_INTEGER` (~90,000 BTC in msats) stays inside JSON numbers,
 * so a point of sale that trusts the advertisement will not refuse a normal
 * invoice while the probe is down.
 */
const BALANCE_UNKNOWN_MSATS = Number.MAX_SAFE_INTEGER

type SpendableCardWallet = Extract<CardWalletRoute, { kind: 'wallet' }>

/**
 * LUD-03 `maxWithdrawable` for a configured card, in millisatoshis.
 *
 * The advertised ceiling is the wallet's live spendable balance, so a point
 * of sale will not mint an invoice the card cannot pay. A failed or slow
 * probe falls back to {@link BALANCE_UNKNOWN_MSATS}.
 */
export async function resolveCardMaxWithdrawableMsats(
  route: SpendableCardWallet
): Promise<number> {
  const msats = await probeCardBalanceMsats(route)
  if (msats === null) {
    logger.warn(
      { walletId: route.walletId },
      'Card scan balance unavailable; advertising a high withdraw ceiling'
    )
  }
  return msats ?? BALANCE_UNKNOWN_MSATS
}

/**
 * The card wallet's spendable balance in msats, or `null` when it can't be
 * read within `timeoutMs`. Never rejects; a probe that loses the race keeps
 * running in the background and its late failure is swallowed.
 */
export async function probeCardBalanceMsats(
  route: SpendableCardWallet,
  timeoutMs = BALANCE_PROBE_MS
): Promise<number | null> {
  const pending = readSpendableMsats(route)
  // A probe that loses the race must not surface later as an unhandled rejection.
  pending.catch(() => {})

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<number>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Card balance probe timed out')),
          timeoutMs
        )
      })
    ])
  } catch (err) {
    logger.debug({ err, walletId: route.walletId }, 'Card balance probe failed')
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function readSpendableMsats(route: SpendableCardWallet): Promise<number> {
  const { driver, config } = driverForWallet({
    id: route.walletId ?? undefined,
    type: route.type,
    config: route.config
  })
  const { balanceSats } = await driver.getBalance(config)
  if (!Number.isSafeInteger(balanceSats) || balanceSats <= 0) return 0
  const msats = balanceSats * 1000
  if (!Number.isSafeInteger(msats)) return BALANCE_UNKNOWN_MSATS
  return msats
}
