import { createHmac } from 'node:crypto'
import type { Logger } from 'pino'
import type { ListenerEnv } from './env'

/**
 * Wakes web's zap settlement sweep.
 *
 * `payment_received` is the fast path for NIP-57, but NIP-47 makes
 * `notifications` optional — a wallet that implements none would leave every
 * zap invoice pending and unreceipted. This tick lets web ask those wallets
 * directly with `lookup_invoice`.
 *
 * The listener stays transport-only here: it carries no settlement opinion and
 * names no invoice. Web selects the candidates and decides what settled means.
 */
export async function requestZapSettlement(
  env: ListenerEnv,
  log: Logger
): Promise<void> {
  const raw = JSON.stringify({})
  const timestamp = String(Date.now())
  const signature = createHmac('sha256', env.LISTENER_AUTH_SECRET)
    .update(`${timestamp}.${raw}`)
    .digest('hex')

  try {
    const response = await fetch(
      new URL('/api/internal/zaps/settle', env.WEB_ORIGIN),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-lawallet-timestamp': timestamp,
          'x-lawallet-signature': `sha256=${signature}`
        },
        body: raw,
        signal: AbortSignal.timeout(30_000)
      }
    )
    if (!response.ok) {
      // A 404 is the expected answer from a web build that predates this
      // endpoint, so this stays a warning rather than an error.
      log.warn({ status: response.status }, 'zap_settle.web_rejected_request')
      return
    }
    const result = await response.json().catch(() => null)
    log.debug({ result }, 'zap_settle.completed')
  } catch (err) {
    log.warn({ err }, 'zap_settle.web_unreachable')
  }
}
