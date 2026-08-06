import { randomUUID } from 'node:crypto'
import type { Event } from 'nostr-tools'
import { Prisma } from '@/lib/generated/prisma'
import { eventBus } from '@/lib/events/event-bus'
import { getListenerConfig } from '@/lib/listener-config'
import { logger } from '@/lib/logger'
import { PROXY_CONFIG_ID } from '@/lib/proxy/constants'
import { publishZapReceipt } from '@/lib/proxy/nostr'
import { decryptProxySecret, isProxyVaultConfigured } from '@/lib/proxy/vault'
import { prisma } from '@/lib/prisma'

const RECEIPT_LEASE_MS = 5 * 60 * 1000
const RECEIPT_RETRY_MS = 10 * 60 * 1000
const RECEIPT_BATCH_SIZE = 25

export interface ZapReceiptCapability {
  /** All invoices minted through a RemoteWallet expose a LUD-21 verify URL. */
  lud21: true
  /** NIP-57 is only safe when the listener can observe settlement. */
  nip57: boolean
  receiptPubkey: string | null
  reason: string | null
}

interface ZapReceiptSigner {
  privateKeyHex: string
  pubkey: string
}

/**
 * Resolve the global receipt signer independently of the deferred proxy's
 * NWC wallet. The signer is an instance identity (published as NIP-05 `_`),
 * so every RemoteWallet uses the same auditable key.
 */
export async function getZapReceiptSigner(): Promise<ZapReceiptSigner | null> {
  if (!isProxyVaultConfigured()) return null
  const config = await prisma.proxyServiceConfig.findUnique({
    where: { id: PROXY_CONFIG_ID },
    select: { id: true, receiptNsecCiphertext: true, receiptPubkey: true }
  })
  if (!config?.receiptNsecCiphertext || !config.receiptPubkey) return null
  try {
    return {
      privateKeyHex: decryptProxySecret(
        config.receiptNsecCiphertext,
        config.id,
        'receipt-nsec'
      ),
      pubkey: config.receiptPubkey
    }
  } catch (error) {
    logger.error({ err: error }, 'nip57.receipt_signer_unavailable')
    return null
  }
}

/** Capability advertised by a local RemoteWallet-backed LUD-16 endpoint. */
export async function getZapReceiptCapability(): Promise<ZapReceiptCapability> {
  const [listener, signer] = await Promise.all([
    getListenerConfig(),
    getZapReceiptSigner()
  ])
  if (!listener.enabled) {
    return {
      lud21: true,
      nip57: false,
      receiptPubkey: signer?.pubkey ?? null,
      reason: 'NIP-57 requires the NWC listener to detect settlement.'
    }
  }
  if (!signer) {
    return {
      lud21: true,
      nip57: false,
      receiptPubkey: null,
      reason: 'The zap receipt signer is not available.'
    }
  }
  return {
    lud21: true,
    nip57: true,
    receiptPubkey: signer.pubkey,
    reason: null
  }
}

/**
 * Publish the receipt associated with an already-settled, local LUD-16
 * invoice. The lease makes webhook replays and LUD-21 polls race safely; a
 * crash after relay publication only republishes the identical signed event.
 */
export async function publishInvoiceZapReceipt(
  invoiceId: string
): Promise<'published' | 'not-ready' | 'skipped'> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      status: true,
      bolt11: true,
      preimage: true,
      paidAt: true,
      zapRequest: true,
      zapRequestJson: true,
      zapReceiptEventId: true
    }
  })
  if (
    !invoice ||
    invoice.status !== 'PAID' ||
    !invoice.zapRequest ||
    !invoice.zapRequestJson ||
    invoice.zapReceiptEventId
  ) {
    return 'skipped'
  }

  const [capability, signer] = await Promise.all([
    getZapReceiptCapability(),
    getZapReceiptSigner()
  ])
  if (!capability.nip57 || !signer) return 'not-ready'

  const now = new Date()
  const leaseOwner = randomUUID()
  const claimed = await prisma.invoice.updateMany({
    where: {
      id: invoice.id,
      status: 'PAID',
      zapReceiptEventId: null,
      AND: [
        {
          OR: [
            { zapReceiptLeaseExpiresAt: null },
            { zapReceiptLeaseExpiresAt: { lt: now } }
          ]
        },
        {
          OR: [
            { zapReceiptNextRetryAt: null },
            { zapReceiptNextRetryAt: { lte: now } }
          ]
        }
      ]
    },
    data: {
      zapReceiptLeaseOwner: leaseOwner,
      zapReceiptLeaseExpiresAt: new Date(now.getTime() + RECEIPT_LEASE_MS)
    }
  })
  if (claimed.count === 0) return 'skipped'

  try {
    const receipt = await publishZapReceipt({
      zapRequest: invoice.zapRequest as unknown as Event,
      zapRequestJson: invoice.zapRequestJson,
      payerInvoice: invoice.bolt11,
      payerPreimage: invoice.preimage,
      privateKeyHex: signer.privateKeyHex,
      createdAtSeconds: Math.floor((invoice.paidAt ?? now).getTime() / 1000)
    })
    const completed = await prisma.invoice.updateMany({
      where: { id: invoice.id, zapReceiptLeaseOwner: leaseOwner },
      data: {
        zapReceipt: receipt.event as unknown as Prisma.InputJsonValue,
        zapReceiptJson: receipt.json,
        zapReceiptEventId: receipt.event.id,
        zapReceiptPublishedAt: new Date(),
        zapReceiptError: null,
        zapReceiptLeaseOwner: null,
        zapReceiptLeaseExpiresAt: null,
        zapReceiptNextRetryAt: null
      }
    })
    if (completed.count > 0) {
      eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })
      return 'published'
    }
    return 'skipped'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.invoice.updateMany({
      where: { id: invoice.id, zapReceiptLeaseOwner: leaseOwner },
      data: {
        zapReceiptError: message.slice(0, 2000),
        zapReceiptLeaseOwner: null,
        zapReceiptLeaseExpiresAt: null,
        zapReceiptNextRetryAt: new Date(Date.now() + RECEIPT_RETRY_MS)
      }
    })
    logger.warn(
      { invoiceId: invoice.id, err: error },
      'nip57.zap_receipt_publish_failed'
    )
    return 'not-ready'
  }
}

/** Retry any direct RemoteWallet zap receipts left behind by relay failures. */
export async function reconcileInvoiceZapReceipts(): Promise<number> {
  const capability = await getZapReceiptCapability()
  if (!capability.nip57) return 0

  const now = new Date()
  const invoices = await prisma.invoice.findMany({
    where: {
      status: 'PAID',
      proxyPayment: null,
      zapRequest: { not: Prisma.DbNull },
      zapReceiptEventId: null,
      AND: [
        {
          OR: [
            { zapReceiptLeaseExpiresAt: null },
            { zapReceiptLeaseExpiresAt: { lt: now } }
          ]
        },
        {
          OR: [
            { zapReceiptNextRetryAt: null },
            { zapReceiptNextRetryAt: { lte: now } }
          ]
        }
      ]
    },
    select: { id: true },
    orderBy: { paidAt: 'asc' },
    take: RECEIPT_BATCH_SIZE
  })
  const results = await Promise.all(
    invoices.map(invoice => publishInvoiceZapReceipt(invoice.id))
  )
  return results.filter(result => result === 'published').length
}
