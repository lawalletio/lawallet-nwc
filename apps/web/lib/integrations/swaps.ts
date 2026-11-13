import type { CreateSwapRequest, SwapProviderId } from '@lawallet-nwc/shared'
import type { Swap } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { eventBus } from '@/lib/events/event-bus'
import { createHash } from 'node:crypto'
import {
  extractAmountSats,
  extractExpiry,
  extractPaymentHash
} from '@/lib/invoice-utils'
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError
} from '@/types/server/errors'
import { getIntegrationConfig } from './server'
import { bullBitcoinProvider } from './bullbitcoin'
import { wapuProvider } from './wapu'
import { lookupAlias } from './alias'
import type { SwapProvider } from './swap-provider'

const log = createLogger({ module: 'integrations:swaps' })

export const SWAP_PROVIDERS: SwapProviderId[] = ['bullbitcoin', 'wapu']

/**
 * The provider invoice may differ from the quote by at most this much.
 * Wapu's quick quote is an approximation of the real order, so this is a
 * sanity bound against a runaway price — the user still confirms the exact
 * invoice amount before paying.
 */
const MAX_QUOTE_DRIFT = 0.03

/** Don't hit the provider more than once per this window per swap. */
const STATUS_REFRESH_MS = 10_000

/** The sooner of two deadlines; null when neither is known. */
function earliest(a?: Date | null, b?: Date | null): Date | null {
  if (!a || !b) return a ?? b ?? null
  return a < b ? a : b
}

/** Tells the owner's open tabs (list + detail) to refetch. */
function emitSwapsUpdated(userId: string) {
  eventBus.emit({ type: 'swaps:updated', timestamp: Date.now(), userId })
}

/** Fiat-transfer ids already matched to a Wapu swap (recent ones). */
async function takenWapuIds(): Promise<ReadonlySet<string>> {
  const rows = await prisma.swap.findMany({
    where: {
      provider: 'wapu',
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600_000) }
    },
    select: { externalId: true }
  })
  return new Set(rows.map(r => r.externalId))
}

/** The provider client, or null when the integration is off/unconfigured. */
export async function getSwapProvider(
  id: SwapProviderId
): Promise<SwapProvider | null> {
  const cfg = await getIntegrationConfig(id)
  if (!cfg.enabled || !cfg.configured) return null
  return id === 'bullbitcoin'
    ? bullBitcoinProvider(cfg.values.bullbitcoin_api_key)
    : wapuProvider(cfg.values.wapu_api_key, takenWapuIds)
}

export interface SwapQuote {
  provider: SwapProviderId
  sats: number | null
  arsPerBtc: number | null
  minArs: number | null
  error?: string
}

/** One quote per available provider; a failing provider reports `error`. */
export async function quoteSwaps(amountArs: number): Promise<SwapQuote[]> {
  const providers = await Promise.all(
    SWAP_PROVIDERS.map(async id => [id, await getSwapProvider(id)] as const)
  )
  return Promise.all(
    providers
      .filter(([, p]) => p)
      .map(async ([provider, p]) => {
        try {
          return { provider, ...(await p!.quote(amountArs)) }
        } catch (e) {
          return {
            provider,
            sats: null,
            arsPerBtc: null,
            minArs: null,
            error: (e as Error).message
          }
        }
      })
  )
}

/**
 * Bull Bitcoin pays only to a 22-digit CBU/CVU, so an alias is resolved
 * through the alias integration first (which also supplies the holder name).
 */
async function resolveDestination(
  input: CreateSwapRequest
): Promise<{ destination: string; holderName?: string }> {
  if (input.provider !== 'bullbitcoin' || /^\d{22}$/.test(input.destination)) {
    return { destination: input.destination, holderName: input.holderName }
  }
  const alias = await getIntegrationConfig('alias')
  if (!alias.enabled || !alias.configured) {
    return { destination: input.destination, holderName: input.holderName }
  }
  const found = await lookupAlias(alias.values.alias_api_url, input.destination)
  return {
    destination: found.cvu || input.destination,
    holderName: input.holderName ?? found.owners[0]?.name
  }
}

export async function createSwap(
  userId: string,
  input: CreateSwapRequest
): Promise<Swap> {
  const provider = await getSwapProvider(input.provider)
  if (!provider) throw new NotFoundError('Swap provider is not available')

  const { destination, holderName } = await resolveDestination(input)
  const quote = await provider.quote(input.amountArs)
  const order = await provider.createSell({
    amountArs: input.amountArs,
    destination,
    holderName
  })

  const invoiceSats = extractAmountSats(order.bolt11)
  if (!invoiceSats) {
    throw new ServiceUnavailableError('Provider returned an invalid invoice')
  }
  if (Math.abs(invoiceSats - quote.sats) / quote.sats > MAX_QUOTE_DRIFT) {
    log.warn(
      { provider: input.provider, invoiceSats, quotedSats: quote.sats },
      'swap invoice amount drifted from quote'
    )
    throw new ServiceUnavailableError(
      'The provider price moved too much — please try again'
    )
  }

  const swap = await prisma.swap.create({
    data: {
      userId,
      provider: input.provider,
      externalId: order.externalId,
      destination,
      holderName: holderName ?? null,
      amountArs: input.amountArs,
      amountSats: invoiceSats,
      bolt11: order.bolt11,
      providerStatus: order.providerStatus,
      expiresAt: earliest(order.expiresAt, extractExpiry(order.bolt11))
    }
  })
  emitSwapsUpdated(userId)
  return swap
}

/**
 * Polls the provider for a pending swap and persists the result. Throttled
 * per swap; provider outages leave the row untouched.
 */
export async function refreshSwap(swap: Swap): Promise<Swap> {
  if (swap.status !== 'PENDING') return swap
  if (Date.now() - swap.updatedAt.getTime() < STATUS_REFRESH_MS) return swap
  const provider = await getSwapProvider(swap.provider as SwapProviderId)
  if (!provider) return swap
  try {
    const next = await provider.status({
      externalId: swap.externalId,
      amountArs: Number(swap.amountArs),
      createdAt: swap.createdAt
    })
    // An unpaid order whose invoice lapsed can no longer be paid. The
    // provider still says "pending" (it never saw a payment), so expire it.
    const paidAt = swap.paidAt ?? (next.paid ? new Date() : null)
    const expiresAt = earliest(swap.expiresAt, next.expiresAt)
    const lapsed =
      next.status === 'PENDING' &&
      !paidAt &&
      !!expiresAt &&
      expiresAt.getTime() < Date.now()
    const updated = await prisma.swap.update({
      where: { id: swap.id },
      data: {
        status: lapsed ? 'EXPIRED' : next.status,
        providerStatus: next.providerStatus,
        externalId: next.externalId ?? swap.externalId,
        receiptUrl: next.receiptUrl ?? swap.receiptUrl,
        paidAt,
        expiresAt
      }
    })
    if (
      updated.status !== swap.status ||
      updated.providerStatus !== swap.providerStatus ||
      updated.receiptUrl !== swap.receiptUrl ||
      updated.paidAt?.getTime() !== swap.paidAt?.getTime() ||
      updated.expiresAt?.getTime() !== swap.expiresAt?.getTime()
    ) {
      emitSwapsUpdated(swap.userId)
    }
    return updated
  } catch (e) {
    log.warn(
      { swapId: swap.id, provider: swap.provider, err: (e as Error).message },
      'swap status refresh failed'
    )
    // Touch updatedAt so a dead provider isn't hammered on every poll.
    return prisma.swap.update({
      where: { id: swap.id },
      data: { providerStatus: swap.providerStatus }
    })
  }
}

/**
 * Records that the user paid the order's invoice. The preimage is the proof:
 * its sha256 must be the invoice's payment hash. Idempotent.
 */
export async function markSwapPaid(
  swap: Swap,
  preimage: string
): Promise<Swap> {
  if (swap.paidAt) return swap
  const hash = createHash('sha256')
    .update(Buffer.from(preimage, 'hex'))
    .digest('hex')
  if (hash !== extractPaymentHash(swap.bolt11)) {
    throw new ValidationError('Preimage does not match the order invoice')
  }
  // A valid preimage beats an expiry/cancel on our side: the invoice was
  // paid, and the provider will wire the pesos.
  const paid = await prisma.swap.update({
    where: { id: swap.id },
    data: {
      paidAt: new Date(),
      ...((swap.status === 'EXPIRED' || swap.status === 'CANCELED') && {
        status: 'PENDING'
      })
    }
  })
  emitSwapsUpdated(swap.userId)
  return paid
}

/**
 * The user drops an unpaid order. Neither provider exposes a cancel call, so
 * this is ours only: the provider is asked first (it may hold a payment we
 * never heard about), and a later valid preimage still revives the order.
 */
export async function cancelSwap(swap: Swap): Promise<Swap> {
  if (swap.status === 'CANCELED') return swap
  if (swap.status !== 'PENDING' || swap.paidAt) {
    throw new ConflictError('Only an unpaid order can be canceled')
  }
  const fresh = await refreshSwap({ ...swap, updatedAt: new Date(0) })
  if (fresh.status !== 'PENDING') {
    throw new ConflictError(
      `This order is already ${fresh.status.toLowerCase()}`
    )
  }
  const canceled = await prisma.swap.update({
    where: { id: swap.id },
    data: { status: 'CANCELED', providerStatus: 'Canceled by user' }
  })
  emitSwapsUpdated(swap.userId)
  return canceled
}

/** How far back the reconcile tick still looks at pending swaps. */
const RECONCILE_WINDOW_MS = 3 * 24 * 3600_000
const RECONCILE_BATCH = 25

/**
 * Refreshes pending swaps from their providers so status moves (and SSE
 * fires) without anyone watching. Runs on the listener's reconcile tick.
 * Unpaid orders are only checked until shortly after their invoice expires;
 * a paid one is followed for the whole window.
 *
 * ponytail: sequential, one provider call per swap (Wapu lists all its
 * transactions each time); batch the Wapu lookups if volume grows.
 */
function followedSwapsWhere(now: number) {
  return {
    status: 'PENDING' as const,
    createdAt: { gte: new Date(now - RECONCILE_WINDOW_MS) },
    OR: [
      { paidAt: { not: null } },
      { expiresAt: { gte: new Date(now - 3600_000) } }
    ]
  }
}

/** How many swaps the reconcile tick is still following. */
export function countFollowedSwaps(): Promise<number> {
  return prisma.swap.count({ where: followedSwapsWhere(Date.now()) })
}

export async function reconcilePendingSwaps(): Promise<number> {
  const pending = await prisma.swap.findMany({
    where: followedSwapsWhere(Date.now()),
    orderBy: { updatedAt: 'asc' },
    take: RECONCILE_BATCH
  })
  let changed = 0
  for (const swap of pending) {
    const next = await refreshSwap(swap)
    if (next.status !== swap.status) changed++
  }
  return changed
}

export const SWAP_PAGE_SIZE_MAX = 50

/** One page of the caller's swaps, newest first. */
export async function listSwapsPage(
  userId: string,
  page: number,
  pageSize: number
) {
  const [items, total] = await Promise.all([
    prisma.swap.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.swap.count({ where: { userId } })
  ])
  return { items: items.map(toSwapDto), total, page, pageSize }
}

export function toSwapDto(swap: Swap) {
  return {
    id: swap.id,
    provider: swap.provider,
    /** Provider order id (Wapu: the matched bank transfer once found). */
    externalId: swap.externalId,
    destination: swap.destination,
    holderName: swap.holderName,
    amountArs: Number(swap.amountArs),
    amountSats: swap.amountSats,
    bolt11: swap.bolt11,
    paymentHash: extractPaymentHash(swap.bolt11) ?? null,
    status: swap.status,
    providerStatus: swap.providerStatus,
    receiptUrl: swap.receiptUrl,
    expiresAt: swap.expiresAt?.toISOString() ?? null,
    paidAt: swap.paidAt?.toISOString() ?? null,
    createdAt: swap.createdAt.toISOString(),
    updatedAt: swap.updatedAt.toISOString()
  }
}
