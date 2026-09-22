import { CARD_WITHDRAW_BALANCE_FALLBACK_MSATS } from '@/lib/validation/schemas'
import { logger } from '@/lib/logger'
import { driverForWallet } from '@/lib/wallet/drivers'
import type { CardWalletRoute } from '@/lib/wallet/resolve-payment-route'

/** Keep the LNURL-withdraw response inside a BoltCard tap budget. */
const BALANCE_PROBE_MS = 1_500

type SpendableCardWallet = Extract<CardWalletRoute, { kind: 'wallet' }>

/**
 * LUD-03 `maxWithdrawable` for a configured card, in millisatoshis.
 *
 * The advertised ceiling is the wallet's live spendable balance, so a point
 * of sale will not mint an invoice the card cannot pay. A failed or slow
 * probe falls back to {@link CARD_WITHDRAW_BALANCE_FALLBACK_MSATS} instead of
 * a product cap — the callback still lets the wallet accept or reject the
 * invoice.
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
    return CARD_WITHDRAW_BALANCE_FALLBACK_MSATS
  } finally {
    if (timer) clearTimeout(timer)
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
  if (!Number.isSafeInteger(msats) || msats <= 0) {
    return CARD_WITHDRAW_BALANCE_FALLBACK_MSATS
  }
  return msats
}
