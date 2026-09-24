import { logger } from '@/lib/logger'
import { driverForWallet } from '@/lib/wallet/drivers'
import type { CardWalletRoute } from '@/lib/wallet/resolve-payment-route'

/** Keep the LNURL-withdraw response inside a BoltCard tap budget. */
const BALANCE_PROBE_MS = 1_500

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
          BALANCE_PROBE_MS
        )
      })
    ])
  } catch (err) {
    logger.warn(
      { err, walletId: route.walletId },
      'Card scan balance unavailable; advertising a high withdraw ceiling'
    )
    return BALANCE_UNKNOWN_MSATS
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
