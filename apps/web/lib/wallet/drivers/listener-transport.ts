import { getConfig } from '@/lib/config'
import {
  nwcProxyResponseSchema,
  type NwcProxyMethod,
} from '@/lib/validation/schemas'
import { DriverError, DriverRemoteError } from './errors'

/**
 * The listener bridge couldn't serve the request for a *transport* reason —
 * service down, wallet not pooled yet, relay hiccup, timeout. Callers may
 * fall back to the direct NWC path. Wallet-level rejections are deliberately
 * NOT this error (see below): a wallet saying "no" must never be retried
 * through a second transport.
 */
export class ListenerUnavailableError extends DriverError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ListenerUnavailableError'
  }
}

/**
 * Whether NWC calls should first try the listener's live relay pool.
 * Relaxed config on purpose: the driver runs inside request paths (and unit
 * tests) where strict env validation may not have happened — with the
 * LISTENER_* vars unset this simply reports `false`.
 */
export function isListenerBridgeEnabled(): boolean {
  // Optional chaining: config mocks in tests are partial objects.
  return getConfig(false).listener?.enabled ?? false
}

/**
 * Proxies one NWC request through the listener service's already-open relay
 * connection (`POST {LISTENER_URL}/nwc/request`). This is the fast path for
 * card withdraws + LUD-16 minting on lambda deployments — no relay
 * handshake per request.
 *
 * Error mapping:
 *  - network error / timeout / unexpected HTTP → {@link ListenerUnavailableError}
 *  - `{ok:false}` with a transport code (`wallet_not_found`,
 *    `wallet_not_connected`, `timeout`, `relay_error`, `validation_error`)
 *    → {@link ListenerUnavailableError}
 *  - `{ok:false, error.code === 'wallet_error'}` → {@link DriverRemoteError}
 *    (final — the wallet itself rejected the request)
 */
export async function listenerNwcRequest<T>(input: {
  connectionString: string
  method: NwcProxyMethod
  params?: Record<string, unknown>
}): Promise<T> {
  const listener = getConfig(false).listener
  if (!listener?.enabled || !listener.url) {
    throw new ListenerUnavailableError('Listener bridge not configured')
  }

  let res: Response
  try {
    res = await fetch(new URL('/nwc/request', listener.url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${listener.secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        connectionString: input.connectionString,
        method: input.method,
        params: input.params ?? {},
      }),
      signal: AbortSignal.timeout(listener.requestTimeoutMs),
      cache: 'no-store',
    })
  } catch (err) {
    throw new ListenerUnavailableError('Listener bridge request failed', {
      cause: err,
    })
  }

  let body: unknown
  try {
    body = await res.json()
  } catch (err) {
    throw new ListenerUnavailableError(
      `Listener bridge returned unparseable response (HTTP ${res.status})`,
      { cause: err }
    )
  }

  const parsed = nwcProxyResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new ListenerUnavailableError(
      `Listener bridge returned malformed response (HTTP ${res.status})`
    )
  }

  if (!parsed.data.ok) {
    const { code, message, walletErrorCode } = parsed.data.error
    if (code === 'wallet_error') {
      // The wallet's own NIP-47 rejection (e.g. INSUFFICIENT_BALANCE) —
      // final, exactly as if the direct path had received it.
      throw new DriverRemoteError(
        `NWC wallet error${walletErrorCode ? ` (${walletErrorCode})` : ''}: ${message}`
      )
    }
    throw new ListenerUnavailableError(
      `Listener bridge unavailable (${code}): ${message}`
    )
  }

  return parsed.data.result as T
}
