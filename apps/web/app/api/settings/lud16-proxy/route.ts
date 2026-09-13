import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  authenticateSettingsReadRequest,
  authenticateSettingsWriteRequest
} from '@/lib/settings-auth'
import { getListenerConfig } from '@/lib/listener-config'
import { driverForWallet } from '@/lib/wallet/drivers'
import { closeServerNwcClient } from '@/lib/wallet/drivers/nwc-client-cache'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody } from '@/lib/validation/middleware'
import { withErrorHandling } from '@/types/server/error-handler'
import { ConflictError, ValidationError } from '@/types/server/errors'
import {
  DEFAULT_PROXY_FEE_BPS,
  MAX_PROXY_FEE_BPS,
  PROXY_CONFIG_ID,
  PROXY_WALLET_ID
} from '@/lib/proxy/constants'
import {
  decryptProxySecret,
  encryptProxySecret,
  isProxyVaultConfigured
} from '@/lib/proxy/vault'
import { normalizeNostrPrivateKey, receiptPubkey } from '@/lib/proxy/nostr'
import { logger } from '@/lib/logger'

const updateSchema = z
  .object({
    enabled: z.boolean().optional(),
    feeBps: z.number().int().min(0).max(MAX_PROXY_FEE_BPS).optional(),
    /** Write-only. Empty string clears the credential. */
    nwcUri: z.string().max(8192).optional(),
    /** Write-only nsec/hex. Empty string clears the signer. */
    receiptNsec: z.string().max(256).optional()
  })
  .refine(value => Object.keys(value).length > 0, {
    message: 'At least one field is required'
  })

/**
 * Read a stored credential, treating one this deployment can no longer open
 * as unknown rather than throwing.
 *
 * The old value is only needed to tell whether the operator is rotating the
 * credential. If an unreadable envelope propagated, the whole PUT would 500
 * and replacing it through this endpoint — the documented recovery after a
 * lost `NWC_VAULT_SECRET` — would be impossible.
 */
function readStoredSecret(
  ciphertext: Uint8Array | null,
  recordId: string,
  field: 'nwc' | 'receipt-nsec'
): string | null {
  if (!ciphertext || !isProxyVaultConfigured()) return null
  try {
    return decryptProxySecret(ciphertext, recordId, field)
  } catch (err) {
    logger.warn(
      { err, proxyConfigId: recordId, field },
      'proxy_settings.stored_secret_unreadable'
    )
    return null
  }
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  await authenticateSettingsReadRequest(request)
  const [config, outstandingPayments, pendingIntents, listener] =
    await Promise.all([
      prisma.proxyServiceConfig.findUnique({ where: { id: PROXY_CONFIG_ID } }),
      prisma.proxyPayment.count({
        where: { status: { notIn: ['COMPLETED', 'EXPIRED'] } }
      }),
      prisma.proxyInvoiceIntent.count({
        where: { expiresAt: { gt: new Date() } }
      }),
      getListenerConfig()
    ])
  return NextResponse.json({
    enabled: config?.enabled ?? false,
    feeBps: config?.feeBps ?? DEFAULT_PROXY_FEE_BPS,
    walletId: config?.walletId ?? PROXY_WALLET_ID,
    hasNwc: Boolean(config?.nwcCiphertext),
    hasReceiptNsec: Boolean(config?.receiptNsecCiphertext),
    receiptPubkey: config?.receiptPubkey ?? null,
    vaultConfigured: isProxyVaultConfigured(),
    listenerEnabled: listener.enabled,
    outstandingPayments: outstandingPayments + pendingIntents,
    capabilities: config?.capabilities ?? null,
    balanceMsats: config?.balanceMsats?.toString() ?? null,
    lastProbeAt: config?.lastProbeAt?.toISOString() ?? null,
    lastProbeError: config?.lastProbeError ?? null,
    lastListenerSeenAt: config?.lastListenerSeenAt?.toISOString() ?? null,
    lastCronAt: config?.lastCronAt?.toISOString() ?? null
  })
})

export const PUT = withErrorHandling(async (request: NextRequest) => {
  await authenticateSettingsWriteRequest(request)
  await checkRequestLimits(request, 'json')
  const body = await validateBody(request, updateSchema)
  if (
    (body.nwcUri !== undefined || body.receiptNsec !== undefined) &&
    !isProxyVaultConfigured()
  ) {
    throw new ValidationError('NWC_VAULT_SECRET is not configured')
  }

  const current = await prisma.proxyServiceConfig.findUnique({
    where: { id: PROXY_CONFIG_ID }
  })
  const [outstandingPayments, pendingIntents] = await Promise.all([
    prisma.proxyPayment.count({
      where: { status: { notIn: ['COMPLETED', 'EXPIRED'] } }
    }),
    prisma.proxyInvoiceIntent.count({
      where: { expiresAt: { gt: new Date() } }
    })
  ])
  const outstanding = outstandingPayments + pendingIntents
  const currentNwc = current
    ? readStoredSecret(current.nwcCiphertext, current.id, 'nwc')
    : null
  const currentNsec = current
    ? readStoredSecret(
        current.receiptNsecCiphertext,
        current.id,
        'receipt-nsec'
      )
    : null
  const nextNwc =
    body.nwcUri === undefined ? currentNwc : body.nwcUri.trim() || null
  let nextNsec = currentNsec
  if (body.receiptNsec !== undefined) {
    try {
      nextNsec = body.receiptNsec.trim()
        ? normalizeNostrPrivateKey(body.receiptNsec)
        : null
    } catch {
      throw new ValidationError(
        'Zap receipt signer must be a valid nsec or 64-character hex key'
      )
    }
  }

  if (
    outstanding > 0 &&
    ((body.nwcUri !== undefined && nextNwc !== currentNwc) ||
      (body.receiptNsec !== undefined && nextNsec !== currentNsec))
  ) {
    throw new ConflictError(
      'Proxy credentials cannot be rotated while settlements are outstanding'
    )
  }
  if (nextNwc) {
    try {
      driverForWallet({
        type: 'NWC',
        config: { connectionString: nextNwc, mode: 'SEND_RECEIVE' }
      })
    } catch {
      throw new ValidationError('Proxy NWC URI is invalid')
    }
  }

  const enabled = body.enabled ?? current?.enabled ?? false
  const listener = await getListenerConfig()
  if (enabled && (!listener.enabled || !nextNwc || !nextNsec)) {
    throw new ValidationError(
      'Enabling requires the listener, a proxy NWC URI, and a zap receipt signer'
    )
  }

  const config = await prisma.proxyServiceConfig.upsert({
    where: { id: PROXY_CONFIG_ID },
    create: {
      id: PROXY_CONFIG_ID,
      walletId: PROXY_WALLET_ID,
      enabled,
      feeBps: body.feeBps ?? DEFAULT_PROXY_FEE_BPS,
      nwcCiphertext: nextNwc
        ? encryptProxySecret(nextNwc, PROXY_CONFIG_ID, 'nwc')
        : null,
      receiptNsecCiphertext: nextNsec
        ? encryptProxySecret(nextNsec, PROXY_CONFIG_ID, 'receipt-nsec')
        : null,
      receiptPubkey: nextNsec ? receiptPubkey(nextNsec) : null
    },
    update: {
      ...(body.enabled !== undefined ? { enabled } : {}),
      ...(body.feeBps !== undefined ? { feeBps: body.feeBps } : {}),
      ...(body.nwcUri !== undefined
        ? {
            nwcCiphertext: nextNwc
              ? encryptProxySecret(nextNwc, PROXY_CONFIG_ID, 'nwc')
              : null
          }
        : {}),
      ...(body.receiptNsec !== undefined
        ? {
            receiptNsecCiphertext: nextNsec
              ? encryptProxySecret(nextNsec, PROXY_CONFIG_ID, 'receipt-nsec')
              : null,
            receiptPubkey: nextNsec ? receiptPubkey(nextNsec) : null
          }
        : {})
    }
  })
  if (body.nwcUri !== undefined && currentNwc && currentNwc !== nextNwc) {
    closeServerNwcClient(currentNwc)
  }
  return NextResponse.json({
    enabled: config.enabled,
    feeBps: config.feeBps,
    walletId: config.walletId,
    hasNwc: Boolean(config.nwcCiphertext),
    hasReceiptNsec: Boolean(config.receiptNsecCiphertext),
    receiptPubkey: config.receiptPubkey
  })
})
