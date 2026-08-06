import { createHash } from 'node:crypto'
import type { Prisma } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import { getListenerConfig } from '@/lib/listener-config'
import { parseExactPaymentInvoice } from '@/lib/invoice-utils'
import { driverForWallet } from '@/lib/wallet/drivers'
import { ServiceUnavailableError, ValidationError } from '@/types/server/errors'
import { getActiveProxyConfig } from './config'
import { calculateProxyAmounts } from './money'
import { fetchDestinationMetadata } from './lnurl'
import { validateZapRequest } from './nostr'

export async function createProxyPayRequest(input: {
  username: string
  userId: string
  destination: string
  blockedHosts: string[]
  amountMsats: number
  comment?: string
  zapRequestJson?: string
}): Promise<{
  invoiceId: string
  proxyPaymentId: string
  bolt11: string
  paymentHash: string
}> {
  const [config, listener] = await Promise.all([
    getActiveProxyConfig(),
    getListenerConfig()
  ])
  if (!config || !listener.enabled) {
    throw new ServiceUnavailableError(
      'Deferred Lightning Address proxy is not available'
    )
  }

  const amounts = calculateProxyAmounts(input.amountMsats, config.row.feeBps)
  const metadata = await fetchDestinationMetadata(input.destination, {
    blockedHosts: input.blockedHosts
  })
  if (
    amounts.destinationAmountMsats < metadata.minSendable ||
    amounts.destinationAmountMsats > metadata.maxSendable
  ) {
    throw new ValidationError('Amount is outside the destination range')
  }
  if (input.comment && input.comment.length > (metadata.commentAllowed ?? 0)) {
    throw new ValidationError(
      'Comment exceeds the destination comment allowance'
    )
  }

  const zap = input.zapRequestJson
    ? validateZapRequest({
        raw: input.zapRequestJson,
        amountMsats: input.amountMsats
      })
    : null
  if (zap && !config.receiptPrivateKey) {
    throw new ValidationError('Zap receipts are not configured')
  }

  const description = `Proxy payment to ${input.destination}`
  const descriptionHash = zap
    ? createHash('sha256').update(zap.canonicalJson).digest('hex')
    : undefined
  // Persist the canonical zap/fee/destination commitment before the external
  // wallet can issue a payer-facing invoice. A crash may leave a harmless
  // stale intent, but can never return an uncommitted NIP-57 invoice.
  const intent = await prisma.proxyInvoiceIntent.create({
    data: {
      username: input.username,
      userId: input.userId,
      destination: input.destination,
      blockedHosts: input.blockedHosts,
      feeBps: config.row.feeBps,
      grossAmountMsats: BigInt(amounts.grossAmountMsats),
      serviceFeeMsats: BigInt(amounts.serviceFeeMsats),
      destinationAmountMsats: BigInt(amounts.destinationAmountMsats),
      comment: input.comment,
      zapRequest: zap
        ? (zap.event as unknown as Prisma.InputJsonValue)
        : undefined,
      zapRequestJson: zap?.canonicalJson,
      descriptionHash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    }
  })
  const { driver, config: walletConfig } = driverForWallet({
    type: 'NWC',
    config: {
      connectionString: config.connectionString,
      mode: 'SEND_RECEIVE'
    }
  })
  let made
  try {
    made = await driver.makeInvoice(walletConfig, {
      amountMsats: input.amountMsats,
      description,
      descriptionHash
    })
  } catch (error) {
    await prisma.proxyInvoiceIntent
      .delete({ where: { id: intent.id } })
      .catch(() => {})
    throw error
  }
  const decodedInvoice = parseExactPaymentInvoice(made.bolt11)
  if (decodedInvoice.amountMsats !== input.amountMsats) {
    throw new ServiceUnavailableError(
      'Proxy wallet returned an invoice with the wrong amount'
    )
  }
  if (
    descriptionHash &&
    decodedInvoice.descriptionHash !== descriptionHash.toLowerCase()
  ) {
    throw new ServiceUnavailableError(
      'Proxy wallet did not commit the zap request into the invoice'
    )
  }
  const paymentHash = decodedInvoice.paymentHash
  if (!/^[0-9a-f]{64}$/.test(paymentHash)) {
    throw new ServiceUnavailableError(
      'Proxy wallet returned an invalid payment hash'
    )
  }
  if (
    made.paymentHash &&
    made.paymentHash.toLowerCase() !== decodedInvoice.paymentHash
  ) {
    throw new ServiceUnavailableError(
      'Proxy wallet returned inconsistent payment hashes'
    )
  }
  const expiresAt = new Date(decodedInvoice.expiresAt)

  const invoiceMetadata = {
    username: input.username,
    destination: input.destination,
    proxy: true,
    ...(input.comment ? { comment: input.comment } : {})
  } as Prisma.InputJsonValue
  const destinationMetadata = metadata as unknown as Prisma.InputJsonValue
  const zapRequest = zap
    ? (zap.event as unknown as Prisma.InputJsonValue)
    : undefined

  return prisma.$transaction(async tx => {
    const invoice = await tx.invoice.create({
      data: {
        bolt11: made.bolt11,
        paymentHash,
        amountSats: Math.floor(input.amountMsats / 1000),
        amountMsats: BigInt(input.amountMsats),
        description,
        purpose: 'LUD16_PAYMENT',
        status: 'PENDING',
        userId: input.userId,
        expiresAt,
        metadata: invoiceMetadata
      }
    })
    const proxyPayment = await tx.proxyPayment.create({
      data: {
        invoiceId: invoice.id,
        username: input.username,
        destination: input.destination,
        blockedHosts: input.blockedHosts,
        destinationMetadata,
        feeBps: config.row.feeBps,
        grossAmountMsats: BigInt(amounts.grossAmountMsats),
        serviceFeeMsats: BigInt(amounts.serviceFeeMsats),
        destinationAmountMsats: BigInt(amounts.destinationAmountMsats),
        comment: input.comment,
        zapRequest,
        zapRequestJson: zap?.canonicalJson,
        status: 'PENDING_INBOUND'
      }
    })
    await tx.proxyInvoiceIntent.delete({ where: { id: intent.id } })
    return {
      invoiceId: invoice.id,
      proxyPaymentId: proxyPayment.id,
      bolt11: made.bolt11,
      paymentHash
    }
  })
}
