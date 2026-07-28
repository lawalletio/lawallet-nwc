import { createHmac } from 'node:crypto'
import type { Logger } from 'pino'
import type { ListenerEnv } from './env'

/**
 * Wakes web's durable proxy reconciler. The listener remains transport-only
 * and does not interpret settlement state.
 */
export async function requestProxyReconcile(
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
      new URL('/api/internal/lud16-proxy/reconcile', env.WEB_ORIGIN),
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
      log.warn(
        { status: response.status },
        'proxy_reconcile.web_rejected_request'
      )
      return
    }
    const result = await response.json().catch(() => null)
    log.debug({ result }, 'proxy_reconcile.completed')
  } catch (err) {
    log.warn({ err }, 'proxy_reconcile.web_unreachable')
  }
}
