import {
  getListenerConfig,
  type ResolvedListenerConfig,
} from '@/lib/listener-config'
import {
  nwcProxyResponseSchema,
  type NwcProxyMethod,
} from '@/lib/validation/schemas'
import { DriverError, DriverRemoteError } from './errors'

export type { ResolvedListenerConfig }

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
 * Resolves the effective bridge config (Settings DB merged over env — see
 * lib/listener-config.ts). Driver methods call this ONCE per operation and
 * pass the result to {@link listenerNwcRequest}, so each NWC call costs a
 * single settings read. Resolution failures degrade to disabled — the bridge
 * is an optimization, never a gate.
 */
export async function resolveListenerBridge(): Promise<ResolvedListenerConfig> {
  try {
    return await getListenerConfig()
  } catch {
    return {
      enabled: false,
      url: null,
      secret: null,
      requestTimeoutMs: 10000,
      urlSource: 'none',
      secretSource: 'none',
      enabledSource: 'none',
    }
  }
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
export async function listenerNwcRequest<T>(
  bridge: ResolvedListenerConfig,
  input: {
    connectionString: string
    method: NwcProxyMethod
    params?: Record<string, unknown>
  }
): Promise<T> {
  if (!bridge.enabled || !bridge.url) {
    throw new ListenerUnavailableError('Listener bridge not configured')
  }

  let res: Response
  try {
    res = await fetch(new URL('/nwc/request', bridge.url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bridge.secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        connectionString: input.connectionString,
        method: input.method,
        params: input.params ?? {},
      }),
      signal: AbortSignal.timeout(bridge.requestTimeoutMs),
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
