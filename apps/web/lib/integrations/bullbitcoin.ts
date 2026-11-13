import { ServiceUnavailableError, ValidationError } from '@/types/server/errors'
import type { SwapProvider } from './swap-provider'
import { normalizeSwapStatus, toSats } from './swap-provider'

/**
 * Bull Bitcoin client, ported from gorilla-bank `lib/bullbitcoin.ts`.
 *
 * JSON-RPC gateway authenticated with an API key (the one the open-source
 * mobile app uses): `POST {base}{path}` with `{jsonrpc, id, method, params}`
 * and `X-API-Key`. Recipient methods also need `x-api-version: 2.0.0`.
 *
 * Off-ramp: find-or-create the CBU/CVU as a fiat recipient, then
 * `sellToRecipient` returns an order carrying the BOLT11 to fund it.
 */

const BASE = 'https://api.bullbitcoin.com'
const ARS_RECIPIENT_TYPE = 'BANK_TRANSFER_ARS'
const TIMEOUT_MS = 15_000

type Json = Record<string, unknown>

class BbError extends ServiceUnavailableError {
  constructor(
    message: string,
    readonly apiCode?: string
  ) {
    super(message)
  }
}

function num(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

async function rpc(
  apiKey: string | null,
  path: string,
  method: string,
  params: Json,
  apiVersion?: string
): Promise<Json> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json'
  }
  if (apiKey) headers['x-api-key'] = apiKey
  if (apiVersion) headers['x-api-version'] = apiVersion

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: '0', method, params }),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const text = await res.text()
  let data: Json = {}
  try {
    data = text ? (JSON.parse(text) as Json) : {}
  } catch {}

  const error = data.error as Json | undefined
  if (!res.ok || error) {
    const errData = error?.data as Json | undefined
    const apiError = errData?.apiError as Json | undefined
    const limit = (errData?.reason as Json | undefined)?.limit as
      Json | undefined
    if (limit && Number.isFinite(Number(limit.amount))) {
      const isMin = limit.conditionalOperator === 'GREATER_THAN_OR_EQUAL'
      throw new ValidationError(
        `Bull Bitcoin: ${isMin ? 'minimum' : 'maximum'} amount is ${limit.amount} ${limit.currencyCode ?? ''}`.trim()
      )
    }
    if (res.status === 401 || res.status === 403) {
      throw new BbError('Bull Bitcoin rejected the API key')
    }
    throw new BbError(
      `Bull Bitcoin: ${String(apiError?.message ?? error?.message ?? `HTTP ${res.status}`)}`,
      apiError?.code as string | undefined
    )
  }
  return (data.result as Json) ?? {}
}

interface Recipient {
  recipientId: string
  claveUniform: string
}

async function listRecipients(apiKey: string): Promise<Recipient[]> {
  const d = await rpc(
    apiKey,
    '/ak/api-recipients',
    'listRecipientsFiat',
    {
      paginator: { page: 1, pageSize: 100 },
      filters: { recipientTypeFiat: [ARS_RECIPIENT_TYPE] }
    },
    '2.0.0'
  )
  return ((d.elements as Json[]) ?? [])
    .filter(r => !r.isArchived && r.recipientId)
    .map(r => ({
      recipientId: String(r.recipientId),
      claveUniform: String(r.claveUniform ?? '')
    }))
}

/** Reuses a saved recipient for the CBU — Bull Bitcoin rejects duplicates. */
export async function findOrCreateRecipient(
  apiKey: string,
  claveUniform: string,
  name: string
): Promise<string> {
  const find = async () =>
    (await listRecipients(apiKey)).find(r => r.claveUniform === claveUniform)
      ?.recipientId
  const existing = await find()
  if (existing) return existing
  try {
    const d = await rpc(
      apiKey,
      '/ak/api-recipients',
      'createRecipientFiat',
      {
        element: {
          recipientTypeFiat: ARS_RECIPIENT_TYPE,
          claveUniform,
          name,
          label: 'lawallet',
          isOwner: false,
          isDefault: false
        }
      },
      '2.0.0'
    )
    const id = (d.element as Json | undefined)?.recipientId
    if (!id) throw new BbError('Bull Bitcoin did not return the recipient')
    return String(id)
  } catch (e) {
    if ((e as BbError).apiCode !== 'ERR_RCP_409') throw e
    // Added concurrently (reuse it), or archived — which the API can't undo.
    const again = await find()
    if (again) return again
    throw new ValidationError(
      'That account is archived in the community’s Bull Bitcoin account'
    )
  }
}

export function bullBitcoinProvider(apiKey: string): SwapProvider {
  return {
    async quote(amountArs) {
      const d = await rpc(null, '/public/price', 'getUserRate', {
        element: { fromCurrency: 'BTC', toCurrency: 'ARS' }
      })
      const el = (d.element as Json) ?? {}
      const raw = num(el.userPrice) ?? num(el.price)
      if (raw == null) throw new BbError('Bull Bitcoin returned no rate')
      const arsPerBtc = raw / 10 ** (num(el.precision) ?? 2)
      return {
        arsPerBtc,
        sats: Math.ceil((amountArs / arsPerBtc) * 1e8),
        minArs: null
      }
    },

    async createSell({ amountArs, destination, holderName }) {
      if (!/^\d{22}$/.test(destination)) {
        throw new ValidationError('Bull Bitcoin needs a 22-digit CBU/CVU')
      }
      const recipientId = await findOrCreateRecipient(
        apiKey,
        destination,
        holderName ?? 'lawallet user'
      )
      const d = await rpc(apiKey, '/ak/api-orders', 'sellToRecipient', {
        recipientId,
        bitcoinNetwork: 'lightning',
        fiatAmount: amountArs
      })
      const order = ((d.element as Json) ?? d) as Json
      const bolt11 = order.lightningInvoice as string | undefined
      if (!bolt11 || !order.orderId) {
        throw new BbError('Bull Bitcoin order came back without an invoice')
      }
      const deadline = order.confirmationDeadline
      return {
        externalId: String(order.orderId),
        bolt11,
        amountSats: toSats(
          num(order.payinAmount) ?? 0,
          String(order.payinCurrency ?? 'BTC')
        ),
        providerStatus: String(order.orderStatus ?? 'Pending'),
        expiresAt:
          typeof deadline === 'string' && !Number.isNaN(Date.parse(deadline))
            ? new Date(deadline)
            : null
      }
    },

    async status(swap) {
      const d = await rpc(apiKey, '/ak/api-orders', 'getOrderSummary', {
        orderId: swap.externalId
      })
      const order = ((d.element as Json) ?? d) as Json
      const raw = String(order.orderStatus ?? 'UNKNOWN')
      return { status: normalizeSwapStatus(raw), providerStatus: raw }
    },

    async test() {
      const d = await rpc(apiKey, '/ak/api-users', 'getUserSummary', {})
      const el = ((d.element as Json) ?? d) as Json
      return el.email
        ? `Connected as ${String(el.email)}`
        : 'Connected to Bull Bitcoin'
    }
  }
}
