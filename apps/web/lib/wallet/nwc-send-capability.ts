import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getServerNwcClient } from '@/lib/wallet/drivers/nwc-client-cache'

/**
 * Whether an NWC connection may be spent from.
 *
 * The `mode` field on a stored NWC config is a *capability cache*, not a user
 * preference: it is written once by the browser-side probe in the create-wallet
 * dialog and silently defaults to `RECEIVE` when that probe doesn't finish in
 * time. Nothing re-checked it afterwards, so a wallet that genuinely advertises
 * `pay_invoice` could stay pinned receive-only forever — card taps refusing with
 * "not enabled for outgoing payments" against a wallet perfectly able to pay.
 *
 * These helpers make the connection itself the source of truth: trust a stored
 * `SEND_RECEIVE` (the wallet already told us), and verify anything else against
 * the wallet before refusing a spend.
 */

const PROBE_TIMEOUT_MS = 3000

/**
 * Re-probing on every tap of a genuinely receive-only wallet would put a relay
 * round-trip on the scan hot path, so a negative verdict is remembered briefly.
 * Positive verdicts need no cache — they are persisted to the row.
 *
 * ponytail: in-process Map, so each server instance probes once per window;
 * move to the settings cache only if that ever shows up in relay load.
 */
const RECEIVE_ONLY_TTL_MS = 5 * 60_000
const receiveOnlyUntil = new Map<string, number>()

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('NWC get_info timed out')), ms)
    )
  ])
}

/**
 * Asks the wallet which methods it grants.
 *
 * @returns `true`/`false` when the wallet answered, `null` when it could not be
 *   reached — callers must not treat unreachable as "cannot send", since that
 *   would let a flaky relay silently downgrade a working wallet.
 */
export async function probeNwcCanSend(
  connectionString: string
): Promise<boolean | null> {
  try {
    const client = await getServerNwcClient(connectionString)
    const info = await withTimeout(client.getInfo(), PROBE_TIMEOUT_MS)
    const methods = Array.isArray(info.methods) ? info.methods.map(String) : []
    return methods.includes('pay_invoice')
  } catch (err) {
    logger.warn({ err }, 'nwc.send_capability_probe_failed')
    return null
  }
}

/**
 * Resolves the mode to persist for a freshly supplied NWC config.
 *
 * The client still sends its own probe result; this confirms it server-side so
 * a slow browser probe can't pin a capable wallet to receive-only. An
 * unreachable wallet keeps whatever the client claimed — creation must not fail
 * on a flaky relay.
 */
export async function resolveNwcModeForCreate(
  connectionString: string,
  claimedMode: 'RECEIVE' | 'SEND_RECEIVE'
): Promise<'RECEIVE' | 'SEND_RECEIVE'> {
  const canSend = await probeNwcCanSend(connectionString)
  if (canSend === null) return claimedMode
  const mode = canSend ? 'SEND_RECEIVE' : 'RECEIVE'
  if (mode !== claimedMode) {
    logger.info(
      { claimedMode, mode },
      'nwc.send_capability_corrected_at_create'
    )
  }
  return mode
}

/**
 * Whether this wallet can pay an invoice, repairing a stale `RECEIVE` in place.
 *
 * A stored `SEND_RECEIVE` is taken at face value (fast path — no relay hop). A
 * stored `RECEIVE` is verified against the wallet; if it turns out to advertise
 * `pay_invoice`, the row is corrected so the next tap takes the fast path.
 */
export async function nwcWalletCanSend(input: {
  walletId: string | null
  config: unknown
}): Promise<boolean> {
  const config = input.config as { connectionString?: string; mode?: string }
  if (config.mode === 'SEND_RECEIVE') return true
  if (!config.connectionString) return false

  const cacheKey = input.walletId ?? config.connectionString
  const until = receiveOnlyUntil.get(cacheKey)
  if (until !== undefined && until > Date.now()) return false

  const canSend = await probeNwcCanSend(config.connectionString)
  if (canSend === null) return false

  if (!canSend) {
    receiveOnlyUntil.set(cacheKey, Date.now() + RECEIVE_ONLY_TTL_MS)
    return false
  }

  receiveOnlyUntil.delete(cacheKey)
  if (input.walletId) await persistSendReceive(input.walletId)
  return true
}

/**
 * Rewrites just the `mode` key on the stored config. The connection string is
 * left exactly as it sits in the row — still vault-encrypted — so this never
 * needs the plaintext and can never re-encrypt it under the wrong wallet id.
 */
async function persistSendReceive(walletId: string): Promise<void> {
  try {
    const wallet = await prisma.remoteWallet.findUnique({
      where: { id: walletId },
      select: { config: true }
    })
    if (!wallet) return

    await prisma.remoteWallet.update({
      where: { id: walletId },
      data: {
        config: {
          ...(wallet.config as Record<string, unknown>),
          mode: 'SEND_RECEIVE'
        }
      }
    })
    logger.info({ walletId }, 'nwc.send_capability_repaired')
  } catch (err) {
    // A failed repair only costs another probe on the next tap — never fail the
    // payment over it.
    logger.warn({ err, walletId }, 'nwc.send_capability_repair_failed')
  }
}
