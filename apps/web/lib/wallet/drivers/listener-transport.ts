import {
  getListenerConfig,
  type ResolvedListenerConfig
} from '@/lib/listener-config'
import {
  nwcPaymentResponseSchema,
  nwcProxyResponseSchema,
  type NwcPaymentRequest,
  type NwcPaymentResponse,
  type NwcProxyMethod
} from '@/lib/validation/schemas'
import { getCurrentReqId } from '@/lib/logger'
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

/** A payment POST may have reached listener; direct retry is forbidden. */
export class ListenerPaymentAmbiguousError extends DriverError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ListenerPaymentAmbiguousError'
  }
}

const PAYMENT_CIRCUIT_MS = 5000
const UNSUPPORTED_CAPABILITY_CACHE_MS = 60_000
let paymentCircuitOpenUntil = 0
let paymentUnsupportedUntil = 0
let halfOpenProbe: ReturnType<typeof setTimeout> | null = null
let capabilityProbe: Promise<boolean> | null = null
let paymentCapabilityUrl: string | null = null
const walletNotReadyUntil = new Map<string, number>()

export function isListenerPaymentCircuitOpen(): boolean {
  return capabilityProbe !== null || Date.now() < paymentCircuitOpenUntil
}

function openPaymentCircuit(bridge?: ResolvedListenerConfig): void {
  paymentCircuitOpenUntil = Date.now() + PAYMENT_CIRCUIT_MS
  paymentCapabilityUrl = null
  if (!bridge || halfOpenProbe) return
  halfOpenProbe = setTimeout(() => {
    halfOpenProbe = null
    void probeListenerCapability(bridge)
  }, PAYMENT_CIRCUIT_MS)
  halfOpenProbe.unref?.()
}

/** Test/health-probe hook. A successful listener call also closes the circuit. */
export function resetListenerPaymentCircuit(): void {
  closePaymentCircuit()
  capabilityProbe = null
  paymentCapabilityUrl = null
  paymentUnsupportedUntil = 0
  walletNotReadyUntil.clear()
}

/**
 * Resolve capability/health before an attempt is pinned to LISTENER. The first
 * call per web process performs one cached `/ready` probe; a missing or old
 * optional listener therefore goes direct without risking an ambiguous POST.
 */
export async function prepareListenerPaymentFastPath(
  bridge: ResolvedListenerConfig,
  walletId: string
): Promise<boolean> {
  if (!bridge.enabled || !bridge.url || !bridge.secret) return false
  const now = Date.now()
  if (
    now < paymentCircuitOpenUntil ||
    now < paymentUnsupportedUntil ||
    now < (walletNotReadyUntil.get(walletId) ?? 0)
  ) {
    return false
  }
  if (paymentCapabilityUrl === bridge.url) return true
  // Half-open/initial probes are single-flight. Only the caller that started
  // the first probe waits; concurrent payment requests stay on direct NWC.
  if (capabilityProbe) return false
  return probeListenerCapability(bridge)
}

function closePaymentCircuit(): void {
  paymentCircuitOpenUntil = 0
  if (halfOpenProbe) clearTimeout(halfOpenProbe)
  halfOpenProbe = null
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
      webhookSecret: null,
      requestTimeoutMs: 10000,
      urlSource: 'none',
      secretSource: 'none',
      enabledSource: 'none'
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
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        connectionString: input.connectionString,
        method: input.method,
        params: input.params ?? {}
      }),
      signal: AbortSignal.timeout(bridge.requestTimeoutMs),
      cache: 'no-store'
    })
  } catch (err) {
    throw new ListenerUnavailableError('Listener bridge request failed', {
      cause: err
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

/**
 * Execute or join one idempotent card payment on listener. Unlike the legacy
 * proxy, network/parse failures are ambiguous: the POST may already have
 * published, so callers must not fall back to a second NWC command.
 */
export async function listenerNwcPayment(
  bridge: ResolvedListenerConfig,
  input: NwcPaymentRequest
): Promise<NwcPaymentResponse> {
  if (!bridge.enabled || !bridge.url || !bridge.secret) {
    return notStarted(
      input.requestId,
      'wallet_not_ready',
      'Listener bridge not configured'
    )
  }
  if (isListenerPaymentCircuitOpen()) {
    return notStarted(
      input.requestId,
      'wallet_not_ready',
      'Listener circuit is open'
    )
  }
  if (Date.now() < paymentUnsupportedUntil) {
    return notStarted(
      input.requestId,
      'wallet_not_ready',
      'Listener does not advertise idempotent payment support'
    )
  }
  if (Date.now() < (walletNotReadyUntil.get(input.walletId) ?? 0)) {
    return notStarted(
      input.requestId,
      'wallet_not_ready',
      'Listener wallet readiness is temporarily bypassed'
    )
  }

  const waitMs = Math.min(8000, Math.max(100, input.waitMs))
  let res: Response
  try {
    res = await fetch(new URL('/v1/nwc/payments', bridge.url), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bridge.secret}`,
        'content-type': 'application/json',
        ...(getCurrentReqId() ? { 'x-request-id': getCurrentReqId()! } : {})
      },
      body: JSON.stringify({ ...input, waitMs }),
      // Listener long-polls for 8s; web owns a fixed 500ms HTTP margin. The
      // generic proxy timeout must not shorten this payment safety budget.
      signal: AbortSignal.timeout(waitMs + 500),
      cache: 'no-store'
    })
  } catch (err) {
    openPaymentCircuit(bridge)
    if (isDefinitePreDispatchNetworkError(err)) {
      return notStarted(
        input.requestId,
        'wallet_not_ready',
        'Listener could not be reached before payment dispatch'
      )
    }
    throw new ListenerPaymentAmbiguousError(
      'Listener payment request outcome is unknown',
      {
        cause: err
      }
    )
  }

  let body: unknown
  try {
    body = await res.json()
  } catch (err) {
    // Auth, validation and unsupported-route responses happen before dispatch
    // and are therefore safe to route directly.
    if ([400, 401, 404].includes(res.status)) {
      if (res.status === 404) {
        paymentUnsupportedUntil = Date.now() + UNSUPPORTED_CAPABILITY_CACHE_MS
      }
      openPaymentCircuit(bridge)
      return notStarted(
        input.requestId,
        'wallet_not_ready',
        `Listener payment endpoint unavailable (HTTP ${res.status})`
      )
    }
    openPaymentCircuit(bridge)
    throw new ListenerPaymentAmbiguousError(
      `Listener payment returned an unparseable response (HTTP ${res.status})`,
      { cause: err }
    )
  }

  const parsed = nwcPaymentResponseSchema.safeParse(body)
  if (!parsed.success) {
    if ([400, 401, 404].includes(res.status)) {
      if (res.status === 404) {
        paymentUnsupportedUntil = Date.now() + UNSUPPORTED_CAPABILITY_CACHE_MS
      }
      openPaymentCircuit(bridge)
      return notStarted(
        input.requestId,
        'wallet_not_ready',
        `Listener payment endpoint unavailable (HTTP ${res.status})`
      )
    }
    openPaymentCircuit(bridge)
    throw new ListenerPaymentAmbiguousError(
      `Listener payment returned a malformed response (HTTP ${res.status})`
    )
  }

  if (parsed.data.requestId.toLowerCase() !== input.requestId.toLowerCase()) {
    openPaymentCircuit(bridge)
    throw new ListenerPaymentAmbiguousError(
      'Listener payment response did not match the submitted request'
    )
  }

  paymentCapabilityUrl = bridge.url
  closePaymentCircuit()
  if (!parsed.data.ok && parsed.data.status === 'not_started') {
    walletNotReadyUntil.set(input.walletId, Date.now() + PAYMENT_CIRCUIT_MS)
  } else {
    walletNotReadyUntil.delete(input.walletId)
  }
  return parsed.data
}

/** Only errors that prove no TCP connection existed are safe to route direct. */
function isDefinitePreDispatchNetworkError(error: unknown): boolean {
  const safeCodes = new Set([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT'
  ])
  let current: unknown = error
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== 'object') return false
    const candidate = current as { code?: unknown; cause?: unknown }
    if (
      typeof candidate.code === 'string' &&
      safeCodes.has(candidate.code.toUpperCase())
    ) {
      return true
    }
    current = candidate.cause
  }
  return false
}

/**
 * Circuit half-open work happens on a timer, never in a card callback. New
 * listeners advertise `nwc_payments_v1`; an old `/ready` response is cached as
 * unsupported so subsequent payments go direct without another HTTP hop.
 */
async function probeListenerCapability(
  bridge: ResolvedListenerConfig
): Promise<boolean> {
  if (!bridge.url) return false
  if (capabilityProbe) return capabilityProbe

  const operation = (async () => {
    try {
      const response = await fetch(new URL('/ready', bridge.url!), {
        headers: bridge.secret
          ? { authorization: `Bearer ${bridge.secret}` }
          : undefined,
        signal: AbortSignal.timeout(1500),
        cache: 'no-store'
      })
      if (response.status === 404) {
        paymentCapabilityUrl = null
        paymentUnsupportedUntil =
          Date.now() + UNSUPPORTED_CAPABILITY_CACHE_MS
        closePaymentCircuit()
        return false
      }
      if (!response.ok)
        throw new Error(`Listener readiness HTTP ${response.status}`)
      const body = (await response.json()) as { capabilities?: unknown }
      if (
        !Array.isArray(body.capabilities) ||
        !body.capabilities.includes('nwc_payments_v1')
      ) {
        paymentCapabilityUrl = null
        paymentUnsupportedUntil =
          Date.now() + UNSUPPORTED_CAPABILITY_CACHE_MS
        closePaymentCircuit()
        return false
      }

      paymentCapabilityUrl = bridge.url
      paymentUnsupportedUntil = 0
      closePaymentCircuit()
      return true
    } catch {
      openPaymentCircuit(bridge)
      return false
    }
  })()
  capabilityProbe = operation
  void operation.finally(() => {
    if (capabilityProbe === operation) capabilityProbe = null
  })
  return operation
}

/** Read a durable listener payment result without ever dispatching work. */
export async function getListenerNwcPayment(
  bridge: ResolvedListenerConfig,
  requestId: string
): Promise<NwcPaymentResponse | null> {
  // Existing LISTENER attempts remain pinned to their original operation even
  // if the operator disables acceleration for new payments.
  if (!bridge.url || !bridge.secret) return null
  let res: Response
  try {
    res = await fetch(
      new URL(`/v1/nwc/payments/${encodeURIComponent(requestId)}`, bridge.url),
      {
        headers: {
          authorization: `Bearer ${bridge.secret}`,
          ...(getCurrentReqId() ? { 'x-request-id': getCurrentReqId()! } : {})
        },
        signal: AbortSignal.timeout(Math.min(bridge.requestTimeoutMs, 3000)),
        cache: 'no-store'
      }
    )
  } catch {
    return null
  }
  if (res.status === 404) return null
  const body = await res.json().catch(() => null)
  const parsed = nwcPaymentResponseSchema.safeParse(body)
  if (!parsed.success) return null
  return parsed.data.requestId.toLowerCase() === requestId.toLowerCase()
    ? parsed.data
    : null
}

function notStarted(
  requestId: string,
  code: 'wallet_not_found' | 'wallet_not_ready',
  message: string
): NwcPaymentResponse {
  return {
    ok: false,
    status: 'not_started',
    requestId,
    error: { code, message }
  }
}
