import { ServiceUnavailableError, ValidationError } from '@/types/server/errors'
import type { SwapProvider } from './swap-provider'
import { normalizeSwapStatus } from './swap-provider'

/**
 * Wapu client, ported from gorilla-bank `lib/wapu.ts` + `lib/swaps.ts`.
 *
 * Off-ramp (direct-fiat, Lightning-funded), `x-api-key` auth:
 *   1. POST /transactions/direct-fiat/tentatives → frozen quote (tentative_id)
 *   2. POST /transactions/direct-fiat/tentatives/{id}/funding → BOLT11
 */

const BASE = 'https://be-prod.wapu.app'
const TIMEOUT_MS = 15_000
export const WAPU_MIN_ARS = 10_000
const TRANSFER_TYPE = 'fast_fiat_transfer'
/**
 * The `tentative-amount` quick quote underprices the real direct-fiat order
 * by ~1.5%; folded in so the preview matches the invoice we later guard.
 */
const OFFRAMP_PREMIUM = 0.015

type Json = Record<string, unknown>

function num(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function pick<T = unknown>(o: Json, keys: string[]): T | undefined {
  for (const k of keys) if (o[k] != null) return o[k] as T
  return undefined
}

async function wapuFetch(
  apiKey: string,
  path: string,
  init?: { method: 'GET' | 'POST'; body?: Json }
): Promise<Json | Json[]> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': apiKey
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const text = await res.text()
  let data: Json = {}
  let isJson = true
  try {
    data = text ? (JSON.parse(text) as Json) : {}
  } catch {
    isJson = false
  }
  if (!res.ok || (typeof data.error === 'string' && data.error)) {
    if (
      !isJson &&
      res.headers.get('x-cache')?.toLowerCase().includes('cloudfront')
    ) {
      throw new ServiceUnavailableError(
        `Wapu’s firewall blocked this server’s IP (HTTP ${res.status}); ask Wapu to allowlist it`
      )
    }
    const msg =
      (data.error as string) ||
      (data.message as string) ||
      (data.detail as string) ||
      `HTTP ${res.status}`
    if (res.status >= 400 && res.status < 500 && res.status !== 401) {
      throw new ValidationError(`Wapu: ${msg}`)
    }
    throw new ServiceUnavailableError(`Wapu: ${msg}`)
  }
  return data
}

async function quote(apiKey: string, amountArs: number) {
  const d = (await wapuFetch(apiKey, '/transactions/tentative-amount', {
    method: 'POST',
    body: {
      amount: amountArs,
      currency_payment: 'ARS',
      currency_taken: 'SAT',
      type: TRANSFER_TYPE
    }
  })) as Json
  const rate = num(pick(d, ['exchange_rate', 'current_rate', 'rate']))
  const fee = num(pick(d, ['fee', 'fee_taken']))
  const gross = num(pick(d, ['usdt_amount', 'amount_taken', 'total_amount']))
  const feeFraction =
    fee != null && gross != null && gross > 0 ? fee / gross : 0
  if (rate == null || rate <= 0 || feeFraction < 0 || feeFraction >= 1) {
    throw new ServiceUnavailableError('Wapu returned no rate')
  }
  const arsPerBtc = rate / (1 + feeFraction) / (1 + OFFRAMP_PREMIUM)
  return {
    arsPerBtc,
    sats: Math.ceil((amountArs / arsPerBtc) * 1e8),
    minArs: WAPU_MIN_ARS
  }
}

/** Wapu timestamps are "YYYY-MM-DD HH:mm:ss" in Argentina time. */
export function artToMs(s: unknown): number | null {
  if (typeof s !== 'string' || !s) return null
  const t = Date.parse(`${s.replace(' ', 'T')}-03:00`)
  return Number.isNaN(t) ? null : t
}

function artToDate(s: unknown): Date | null {
  const ms = artToMs(s)
  return ms == null ? null : new Date(ms)
}

export interface WapuTx {
  transactionId: string
  type: string
  status: string
  paymentAmount: number
  paymentCurrency: string
  createdAt: string | null
  expiresAt: string | null
  receiptImageUrl: string | null
}

/**
 * A payout yields two Wapu transactions (Lightning `deposit` + the
 * `fiat_transfer`) that Wapu does not link. Match the transfer by its known
 * id, else by ARS amount (±0.1%) and the creation time closest to the swap,
 * skipping transfers another swap already claimed.
 */
export function matchFiatTransfer(
  txs: WapuTx[],
  swap: { externalId: string; amountArs: number; createdAt: Date },
  taken: ReadonlySet<string>
): WapuTx | null {
  const byId = txs.find(
    t => t.transactionId === swap.externalId && /fiat/i.test(t.type)
  )
  if (byId) return byId
  const swapMs = swap.createdAt.getTime()
  const tol = Math.max(1, swap.amountArs * 0.001)
  return (
    txs
      .filter(
        t =>
          /fiat_transfer/i.test(t.type) &&
          t.paymentCurrency === 'ARS' &&
          !taken.has(t.transactionId) &&
          Math.abs(t.paymentAmount - swap.amountArs) <= tol
      )
      .map(t => ({ t, ms: artToMs(t.createdAt) }))
      .filter(({ ms }) => ms == null || ms >= swapMs - 15 * 60_000)
      .sort(
        (a, b) =>
          Math.abs((a.ms ?? swapMs) - swapMs) -
          Math.abs((b.ms ?? swapMs) - swapMs)
      )[0]?.t ?? null
  )
}

async function listTransactions(apiKey: string): Promise<WapuTx[]> {
  const d = await wapuFetch(apiKey, '/transactions/my_transactions')
  const arr = Array.isArray(d) ? d : ((d.transactions as Json[]) ?? [])
  return arr.map(t => ({
    transactionId: String(t.transaction_id ?? ''),
    type: String(t.type ?? ''),
    status: String(t.status ?? ''),
    paymentAmount: Number(t.payment_amount ?? 0),
    paymentCurrency: String(t.payment_currency ?? ''),
    createdAt: (t.created_at as string) ?? null,
    expiresAt: (t.expires_at as string) ?? null,
    receiptImageUrl: (t.receipt_image_url as string) ?? null
  }))
}

export function wapuProvider(
  apiKey: string,
  /** Fiat-transfer ids already matched to other swaps. */
  takenIds: () => Promise<ReadonlySet<string>> = async () => new Set()
): SwapProvider {
  return {
    quote: amountArs => quote(apiKey, amountArs),

    async createSell({ amountArs, destination, holderName }) {
      if (amountArs < WAPU_MIN_ARS) {
        throw new ValidationError(`Wapu minimum is ARS ${WAPU_MIN_ARS}`)
      }
      const tentative = (await wapuFetch(
        apiKey,
        '/transactions/direct-fiat/tentatives',
        {
          method: 'POST',
          body: {
            amount_ars: amountArs,
            type: TRANSFER_TYPE,
            alias: destination,
            receiver_name: holderName ?? '',
            funding_method: 'LIGHTNING',
            network: 'LIGHTNING'
          }
        }
      )) as Json
      const id = pick<string>(tentative, ['tentative_id', 'uuid', 'id'])
      if (!id) throw new ServiceUnavailableError('Wapu returned no order id')

      const funding = (await wapuFetch(
        apiKey,
        `/transactions/direct-fiat/tentatives/${encodeURIComponent(id)}/funding`,
        { method: 'POST', body: {} }
      )) as Json
      const bolt11 = pick<string>(funding, [
        'lightning_pr',
        'lnurl_pr_invoice',
        'bolt11',
        'payment_request'
      ])
      if (!bolt11) {
        throw new ServiceUnavailableError(
          'Wapu order came back without an invoice'
        )
      }
      return {
        externalId:
          pick<string>(funding, ['funding_transaction_id', 'transaction_id']) ??
          id,
        bolt11,
        amountSats:
          num(pick(funding, ['funding_amount_sat', 'total_amount_taken'])) ?? 0,
        providerStatus: pick<string>(funding, ['status']) ?? 'Pending',
        // Wapu's own deadline when it sends one; createSwap keeps the
        // earlier of this and the invoice expiry.
        expiresAt: artToDate(
          pick(funding, ['expires_at', 'expiration_date', 'expires'])
        )
      }
    },

    async status(swap) {
      const [txs, taken] = await Promise.all([
        listTransactions(apiKey),
        takenIds()
      ])
      const match = matchFiatTransfer(txs, swap, taken)
      if (match) {
        return {
          status: normalizeSwapStatus(match.status),
          providerStatus: match.status,
          externalId: match.transactionId,
          receiptUrl: match.receiptImageUrl,
          paid: true
        }
      }
      // No transfer yet: the order's Lightning `deposit` (our externalId)
      // tells paid / still open / dropped, and carries Wapu's deadline.
      const deposit = txs.find(
        t => t.transactionId === swap.externalId && /deposit/i.test(t.type)
      )
      const expiresAt = artToDate(deposit?.expiresAt)
      const state = deposit && normalizeSwapStatus(deposit.status)
      if (state === 'COMPLETED') {
        return {
          status: 'PENDING',
          providerStatus: 'Sats received',
          paid: true,
          expiresAt
        }
      }
      if (deposit && state !== 'PENDING') {
        // An unpaid deposit that ended moved no funds.
        return { status: 'EXPIRED', providerStatus: deposit.status, expiresAt }
      }
      return {
        status: 'PENDING',
        providerStatus: 'Awaiting transfer',
        expiresAt
      }
    },

    async test() {
      const q = await quote(apiKey, WAPU_MIN_ARS)
      return `Connected — 1 sat ≈ ARS ${(q.arsPerBtc / 1e8).toFixed(4)}`
    }
  }
}
