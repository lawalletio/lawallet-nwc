import { logger } from '@/lib/logger'
import { driverForWallet } from '@/lib/wallet/drivers'
import type { CardWalletRoute } from '@/lib/wallet/resolve-payment-route'
import { recordWalletBalance } from '@/lib/wallet/last-balance'

/**
 * How long the card callback waits for the wallet balance before falling back
 * to the payment result. With web next to the listener the read is one relay
 * round-trip (p95 ~500 ms).
 */
export const BALANCE_PROBE_MS = 600

type SpendableCardWallet = Extract<CardWalletRoute, { kind: 'wallet' }>

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
  // Not awaited: the write must not eat into the tap's BALANCE_PROBE_MS window.
  if (route.walletId) void recordWalletBalance(route.walletId, balanceSats)
  if (!Number.isSafeInteger(balanceSats) || balanceSats <= 0) return 0
  const msats = balanceSats * 1000
  if (!Number.isSafeInteger(msats)) throw new Error('Balance out of range')
  return msats
}
