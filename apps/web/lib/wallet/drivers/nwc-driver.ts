import { z } from 'zod'
import { createHash } from 'node:crypto'
import { withSpan } from '@/lib/observability/timing'
import { logger } from '@/lib/logger'
import {
  DriverRemoteError,
  PaymentOutcomeUnknownError,
  PaymentRejectedError
} from './errors'
import {
  listenerNwcPayment,
  listenerNwcRequest,
  ListenerPaymentAmbiguousError,
  ListenerUnavailableError,
  resolveListenerBridge
} from './listener-transport'
import { getServerNwcClient } from './nwc-client-cache'
import type {
  BalanceResult,
  MakeInvoiceInput,
  MakeInvoiceResult,
  PayInvoiceInput,
  PayInvoiceResult,
  RemoteWalletDriver,
  WalletOperationContext
} from './types'

const DIRECT_PAYMENT_CACHE_MS = 5 * 60 * 1000
const DIRECT_PAYMENT_TIMEOUT_MS = 60_000
const directPayments = new Map<string, Promise<PayInvoiceResult>>()

/**
 * `RemoteWallet.config` shape for NWC wallets. We persist:
 *
 *  - `connectionString` — the NWC pairing URI. Everything derived from it
 *    (relay URL, wallet pubkey, …) is parsed by the SDK on every call, so
 *    there's only one source of truth here.
 *  - `mode` — `RECEIVE` (default) or `SEND_RECEIVE`. Mirrors the legacy
 *    `NWCConnection.mode` enum that the #231 migration copied forward into
 *    JSON. We default to `RECEIVE` so older payloads written before this
 *    field existed still parse.
 */
const hexKey = /^[0-9a-f]{64}$/i
const bech32NostrKey = /^(?:npub|nsec)1[023456789acdefghjklmnpqrstuvwxyz]{58}$/i

function isValidNwcConnectionString(value: string): boolean {
  try {
    if (!/^(?:nostr\+walletconnect|nostrwalletconnect):\/\//i.test(value)) {
      return false
    }
    const normalized = value
      .replace(/^nostr\+walletconnect:\/\//, 'https://')
      .replace(/^nostrwalletconnect:\/\//, 'https://')
    const url = new URL(normalized)
    const walletPubkey = url.hostname
    const secret = url.searchParams.get('secret') ?? ''
    const relays = url.searchParams.getAll('relay')
    if (
      !(hexKey.test(walletPubkey) || bech32NostrKey.test(walletPubkey)) ||
      !(hexKey.test(secret) || bech32NostrKey.test(secret)) ||
      relays.length === 0
    ) {
      return false
    }
    return relays.every(relay => {
      const relayUrl = new URL(relay)
      return (
        (relayUrl.protocol === 'wss:' || relayUrl.protocol === 'ws:') &&
        relayUrl.hostname.length > 0
      )
    })
  } catch {
    return false
  }
}

const nwcConfigSchema = z
  .object({
    connectionString: z
      .string()
      .min(1, 'connectionString is required')
      .refine(isValidNwcConnectionString, {
        message:
          'connectionString must include a valid wallet pubkey, secret, and ws(s) relay'
      }),
    mode: z.enum(['RECEIVE', 'SEND_RECEIVE']).default('RECEIVE'),
    // When the wallet was provisioned by LNCurl we tag it so the LUD-16 +
    // signup flows can transparently re-provision a dead wallet. Optional so
    // every pre-LNCurl payload still parses.
    provider: z.literal('lncurl').optional(),
    // The LNCurl origin this wallet was minted from, so re-provisioning hits
    // the same deployment. Optional + URL-validated.
    lncurlServerUrl: z.string().url().optional()
  })
  .strict()

export type NwcDriverConfig = z.infer<typeof nwcConfigSchema>

/**
 * NWC driver — the first concrete {@link RemoteWalletDriver}. Wraps the
 * `@getalby/sdk` `NWCClient` so the rest of the platform never touches the
 * SDK directly. The driver:
 *
 *  - normalises msats → sats at the boundary (NWC speaks msats; the platform
 *    speaks sats end-to-end),
 *  - translates SDK errors into {@link DriverRemoteError} so callers can
 *    handle wallet failures uniformly across driver types,
 *  - shares relay subscriptions via {@link getServerNwcClient}.
 *
 * Capability detection (e.g. whether a connection was granted
 * `make_invoice`) lives in higher-level callers — the driver simply
 * surfaces the wallet's rejection as a {@link DriverRemoteError} if a
 * method isn't permitted.
 */
export const nwcDriver: RemoteWalletDriver<NwcDriverConfig> = {
  type: 'NWC',
  configSchema: nwcConfigSchema,

  async getBalance(config): Promise<BalanceResult> {
    return withSpan('nwc.get_balance', async () => {
      const bridge = await resolveListenerBridge()
      if (bridge.enabled) {
        try {
          const res = await listenerNwcRequest<{ balance: number }>(bridge, {
            connectionString: config.connectionString,
            method: 'get_balance'
          })
          return { balanceSats: Math.floor(res.balance / 1000) }
        } catch (err) {
          // Wallet rejections (DriverRemoteError) are final; only transport
          // failures fall back to the direct relay connection below.
          if (!(err instanceof ListenerUnavailableError)) throw err
          logger.warn(
            { err },
            'nwc.listener_bridge_unavailable — falling back to direct NWC'
          )
        }
      }
      try {
        const client = await getServerNwcClient(config.connectionString)
        const res = await client.getBalance()
        return {
          balanceSats: Math.floor(res.balance / 1000)
        }
      } catch (err) {
        throw new DriverRemoteError('NWC get_balance failed', { cause: err })
      }
    })
  },

  async payInvoice(
    config,
    input: PayInvoiceInput,
    context?: WalletOperationContext
  ): Promise<PayInvoiceResult> {
    return withSpan('nwc.pay_invoice', async () => {
      const bridge = context?.listenerBridge ?? (await resolveListenerBridge())

      // Only payments carrying durable identity may use listener. Unidentified
      // payments stay direct: the legacy proxy cannot safely fall back after a
      // timeout because its original SDK call may still be running.
      if (
        context?.transport === 'LISTENER' &&
        context.walletId &&
        context.requestId &&
        context.paymentHash
      ) {
        try {
          // The callback chooses and persists LISTENER before entering the
          // driver. Settings may be invalidated between that decision and this
          // cached config read. Since no listener POST has happened yet, this
          // is a safe not-started hand-off — but it must be recorded before the
          // direct SDK can publish anything.
          if (!bridge.enabled || !bridge.url || !bridge.secret) {
            logger.warn(
              'nwc.listener_payment_unconfigured_after_selection — using direct NWC'
            )
            if (
              context.beforeDirectFallback &&
              !(await context.beforeDirectFallback())
            ) {
              throw new PaymentOutcomeUnknownError(
                'Payment state changed before direct fallback',
                'LISTENER'
              )
            }
            return directPayInvoice(config.connectionString, input, context)
          }

          const result = await listenerNwcPayment(bridge, {
            requestId: context.requestId,
            walletId: context.walletId,
            paymentHash: context.paymentHash,
            invoice: input.bolt11,
            waitMs: Math.min(8000, Math.max(100, context.deadlineMs ?? 8000))
          })
          if (result.ok) {
            return {
              preimage: result.preimage,
              feesPaidSats: Math.floor(result.feesPaidMsats / 1000),
              feesPaidMsats: result.feesPaidMsats,
              transport: 'LISTENER'
            }
          }
          if (result.status === 'rejected') {
            throw new PaymentRejectedError(
              result.error?.message ?? 'NWC wallet rejected payment',
              {
                code: result.error?.walletErrorCode,
                transport: 'LISTENER'
              }
            )
          }
          if (result.status === 'pending' || result.status === 'unknown') {
            throw new PaymentOutcomeUnknownError(
              result.error?.message ?? 'Listener payment is still pending',
              'LISTENER'
            )
          }
          // `not_started` is explicit proof that listener never invoked NWC.
          logger.warn(
            { code: result.error?.code },
            'nwc.listener_payment_not_started — using direct NWC'
          )
          if (
            context.beforeDirectFallback &&
            !(await context.beforeDirectFallback())
          ) {
            throw new PaymentOutcomeUnknownError(
              'Payment state changed before direct fallback',
              'LISTENER'
            )
          }
        } catch (err) {
          if (
            err instanceof PaymentRejectedError ||
            err instanceof PaymentOutcomeUnknownError
          ) {
            throw err
          }
          if (err instanceof ListenerPaymentAmbiguousError) {
            throw new PaymentOutcomeUnknownError(
              'Listener payment outcome is unknown',
              'LISTENER',
              { cause: err }
            )
          }
          throw err
        }
      }
      return directPayInvoice(config.connectionString, input, context)
    })
  },

  async makeInvoice(
    config,
    input: MakeInvoiceInput
  ): Promise<MakeInvoiceResult> {
    if (!Number.isFinite(input.amountSats) || input.amountSats <= 0) {
      throw new DriverRemoteError('makeInvoice requires a positive amount')
    }
    return withSpan('nwc.make_invoice', async () => {
      const bridge = await resolveListenerBridge()
      if (bridge.enabled) {
        try {
          const res = await listenerNwcRequest<{
            invoice: string
            payment_hash: string
            amount: number
            description?: string
            expires_at?: number
          }>(bridge, {
            connectionString: config.connectionString,
            method: 'make_invoice',
            params: {
              amount: input.amountSats * 1000,
              description: input.description ?? ''
            }
          })
          return {
            bolt11: res.invoice,
            paymentHash: res.payment_hash,
            amountSats: Math.floor(res.amount / 1000),
            description: res.description ?? input.description ?? '',
            expiresAt:
              typeof res.expires_at === 'number' ? res.expires_at * 1000 : null
          }
        } catch (err) {
          if (!(err instanceof ListenerUnavailableError)) throw err
          logger.warn(
            { err },
            'nwc.listener_bridge_unavailable — falling back to direct NWC'
          )
        }
      }
      try {
        const client = await getServerNwcClient(config.connectionString)
        const res = await client.makeInvoice({
          // NWC speaks msats.
          amount: input.amountSats * 1000,
          description: input.description ?? ''
        })
        return {
          bolt11: res.invoice,
          paymentHash: res.payment_hash,
          amountSats: Math.floor(res.amount / 1000),
          description: res.description ?? input.description ?? '',
          // NWC reports expiry in unix seconds; normalise to ms (or null).
          expiresAt:
            typeof res.expires_at === 'number' ? res.expires_at * 1000 : null
        }
      } catch (err) {
        // Re-throw our own validation error untouched; wrap everything else.
        if (err instanceof DriverRemoteError) throw err
        throw new DriverRemoteError('NWC make_invoice failed', { cause: err })
      }
    })
  }
}

function directPayInvoice(
  connectionString: string,
  input: PayInvoiceInput,
  context?: WalletOperationContext
): Promise<PayInvoiceResult> {
  const key = context?.requestId
  if (key) {
    const existing = directPayments.get(key)
    if (existing) return existing
  }

  const payment = executeDirectPayInvoice(
    connectionString,
    input,
    Boolean(context?.requestId)
  )
  if (key) {
    directPayments.set(key, payment)
    const timer = setTimeout(() => {
      if (directPayments.get(key) === payment) directPayments.delete(key)
    }, DIRECT_PAYMENT_CACHE_MS)
    timer.unref?.()
  }
  return payment
}

async function executeDirectPayInvoice(
  connectionString: string,
  input: PayInvoiceInput,
  includeOperationMetadata: boolean
): Promise<PayInvoiceResult> {
  try {
    const client = await getServerNwcClient(connectionString)
    const res = await waitWithoutCancelling(
      client.payInvoice({
        invoice: input.bolt11,
        amount:
          input.amountSats !== undefined ? input.amountSats * 1000 : undefined
      }),
      DIRECT_PAYMENT_TIMEOUT_MS
    )
    return {
      preimage: res.preimage,
      feesPaidSats: Math.floor((res.fees_paid ?? 0) / 1000),
      ...(includeOperationMetadata
        ? {
            feesPaidMsats: res.fees_paid ?? 0,
            transport: 'DIRECT' as const
          }
        : {})
    }
  } catch (err) {
    if (isNip47WalletError(err)) {
      throw new PaymentRejectedError('NWC wallet rejected payment', {
        cause: err,
        code: errorCode(err),
        transport: 'DIRECT'
      })
    }
    throw new PaymentOutcomeUnknownError(
      'Direct NWC payment outcome is unknown',
      'DIRECT',
      { cause: err }
    )
  }
}

/**
 * Bound the callback wait without cancelling an irrevocable NWC command. A
 * late relay response may still complete and be reconciled by notification or
 * lookup, but the caller will never publish a second request automatically.
 */
function waitWithoutCancelling<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`NWC payment timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
    timer.unref?.()
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** Join an in-process direct payment without ever creating a new dispatch. */
export function getInFlightDirectPayment(
  requestId: string
): Promise<PayInvoiceResult> | null {
  return directPayments.get(requestId) ?? null
}

/**
 * Read-only recovery for a direct payment after a process restart. It never
 * invokes pay_invoice, so a missing/unsupported lookup remains safely unknown.
 */
export async function reconcileDirectNwcPayment(
  connectionString: string,
  paymentHash: string
): Promise<PayInvoiceResult | 'rejected' | null> {
  try {
    const client = await getServerNwcClient(connectionString)
    const tx = await client.lookupInvoice({ payment_hash: paymentHash })
    if (tx.state === 'failed') return 'rejected'
    if (tx.state !== 'settled' || !tx.preimage) return null
    const actualHash = createHash('sha256')
      .update(Buffer.from(tx.preimage, 'hex'))
      .digest('hex')
    if (actualHash !== paymentHash.toLowerCase()) return null
    return {
      preimage: tx.preimage,
      feesPaidSats: Math.floor((tx.fees_paid ?? 0) / 1000),
      feesPaidMsats: tx.fees_paid ?? 0,
      transport: 'DIRECT'
    }
  } catch {
    return null
  }
}

function isNip47WalletError(error: unknown): boolean {
  return error instanceof Error && error.constructor.name === 'Nip47WalletError'
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined
}
