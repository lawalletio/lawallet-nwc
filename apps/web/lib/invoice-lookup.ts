import bolt11 from 'bolt11'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/types/server/errors'
import { decodeInvoiceFields, normalizeInvoice } from '@/lib/decode-invoice'

const AMBOSS_URL = 'https://api.amboss.space/graphql'
const AMBOSS_NODE_QUERY = `query($pubkey: String!) {
  getNode(pubkey: $pubkey) {
    graph_info {
      last_update
      node { alias color addresses { addr } }
      metrics { capacity capacity_rank channels channels_rank }
    }
    socials { info { website twitter telegram nostr lightning_address message } }
  }
}`

const userSelect = {
  id: true,
  pubkey: true,
  role: true,
  lightningAddresses: {
    where: { isPrimary: true },
    take: 1,
    select: { username: true }
  }
} as const

const walletSelect = { id: true, name: true, type: true, status: true } as const

/**
 * Display fields plus what only a full decode gives: signature verification
 * (throws on a forged/corrupt invoice) and the recovered payee node key.
 */
export function decodeInvoice(invoice: string) {
  let payeeNodeKey: string | null
  try {
    payeeNodeKey = bolt11.decode(invoice).payeeNodeKey ?? null
  } catch (err) {
    throw new ValidationError(
      `Invalid Lightning invoice: ${err instanceof Error ? err.message : 'undecodable'}`
    )
  }
  return { ...decodeInvoiceFields(invoice), payeeNodeKey }
}

function flattenUser(
  u: {
    id: string
    pubkey: string
    role: string
    lightningAddresses: { username: string }[]
  } | null
) {
  if (!u) return null
  const { lightningAddresses, ...rest } = u
  return { ...rest, primaryAddress: lightningAddresses[0]?.username ?? null }
}

async function lookupLocal(paymentHash: string | null, invoice: string) {
  const [received, cardPayments, swaps] = await Promise.all([
    paymentHash
      ? prisma.invoice.findUnique({
          where: { paymentHash },
          select: {
            id: true,
            purpose: true,
            status: true,
            amountSats: true,
            description: true,
            metadata: true,
            preimage: true,
            expiresAt: true,
            paidAt: true,
            createdAt: true,
            zapReceiptEventId: true,
            user: { select: userSelect },
            remoteWallet: { select: walletSelect },
            proxyPayment: {
              select: {
                status: true,
                destination: true,
                sourcePreimage: true,
                forwardedAt: true,
                lastError: true
              }
            }
          }
        })
      : null,
    paymentHash
      ? prisma.cardPaymentAttempt.findMany({
          where: { paymentHash },
          select: {
            id: true,
            walletId: true,
            amountMsats: true,
            status: true,
            transport: true,
            preimage: true,
            feesPaidMsats: true,
            errorCode: true,
            createdAt: true,
            resolvedAt: true,
            card: {
              select: {
                id: true,
                title: true,
                username: true,
                user: { select: userSelect }
              }
            }
          }
        })
      : [],
    // Swap has no paymentHash column; the bolt11 is stored as received.
    prisma.swap.findMany({
      where: { bolt11: { equals: invoice, mode: 'insensitive' } },
      select: {
        id: true,
        provider: true,
        status: true,
        amountArs: true,
        destination: true,
        paidAt: true,
        createdAt: true,
        user: { select: userSelect }
      }
    })
  ])

  return {
    invoice: received && {
      ...received,
      user: flattenUser(received.user)
    },
    cardPayments: cardPayments.map(p => ({
      ...p,
      amountMsats: p.amountMsats.toString(),
      card: { ...p.card, user: flattenUser(p.card.user) }
    })),
    swaps: swaps.map(s => ({
      ...s,
      amountArs: s.amountArs.toString(),
      user: flattenUser(s.user)
    }))
  }
}

/** Public Amboss graph data for a node. Never throws — the UI shows `error`. */
export async function lookupAmbossNode(pubkey: string) {
  try {
    const res = await fetch(AMBOSS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: AMBOSS_NODE_QUERY, variables: { pubkey } }),
      signal: AbortSignal.timeout(8000),
      cache: 'no-store'
    })
    if (!res.ok) return { error: `Amboss responded HTTP ${res.status}` }
    const body = await res.json()
    const node = body?.data?.getNode
    if (!node?.graph_info?.node)
      return { error: 'Node not found on Amboss (private or unannounced)' }
    const { graph_info: g, socials } = node
    return {
      alias: g.node.alias ?? null,
      color: g.node.color ?? null,
      addresses: (g.node.addresses ?? []).map((a: { addr: string }) => a.addr),
      lastUpdate: g.last_update ?? null,
      capacitySats: g.metrics?.capacity ?? null,
      capacityRank: g.metrics?.capacity_rank ?? null,
      channels: g.metrics?.channels ?? null,
      channelsRank: g.metrics?.channels_rank ?? null,
      socials: socials?.info ?? null,
      url: `https://amboss.space/node/${pubkey}`
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Amboss unreachable' }
  }
}

/**
 * Decode an invoice and resolve everything we know about it: local rows
 * (minted here, paid by a card, or sent to a swap) and, for invoices not
 * minted here, the payee node's public graph data from Amboss.
 */
export async function lookupInvoice(raw: string) {
  const invoice = normalizeInvoice(raw)
  const decoded = decodeInvoice(invoice)
  const local = await lookupLocal(decoded.paymentHash, invoice)
  const isLocal = local.invoice !== null
  const node =
    !isLocal && decoded.payeeNodeKey
      ? await lookupAmbossNode(decoded.payeeNodeKey)
      : null
  return { invoice, decoded, isLocal, local, node }
}

export type InvoiceLookupResult = Awaited<ReturnType<typeof lookupInvoice>>
