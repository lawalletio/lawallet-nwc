import { getConfig } from '@/lib/config'
import { createLogger } from '@/lib/logger'
import { generatePrivateKey } from '@/lib/nostr'
import { prisma } from '@/lib/prisma'
import {
  DEFAULT_PROXY_FEE_BPS,
  PROXY_CONFIG_ID,
  PROXY_WALLET_ID
} from '@/lib/proxy/constants'
import { receiptPubkey } from '@/lib/proxy/nostr'
import { encryptProxySecret } from '@/lib/proxy/vault'

const log = createLogger({ module: 'proxy-receipt-signer' })

/**
 * Creates the singleton proxy config with a random NIP-57 receipt signer.
 *
 * The config row itself is the initialization marker: once it exists, this
 * function never changes it. That keeps startup idempotent and preserves any
 * signer the operator later rotates (or deliberately clears) through settings.
 * `createMany({ skipDuplicates: true })` makes concurrent cold starts safe.
 */
export async function initializeProxyReceiptSigner(): Promise<boolean> {
  if (!getConfig(false).nwcVault.enabled) return false

  const existing = await prisma.proxyServiceConfig.findUnique({
    where: { id: PROXY_CONFIG_ID },
    select: { id: true }
  })
  if (existing) return false

  const privateKeyHex = generatePrivateKey()
  const publicKeyHex = receiptPubkey(privateKeyHex)
  const result = await prisma.proxyServiceConfig.createMany({
    data: [
      {
        id: PROXY_CONFIG_ID,
        enabled: false,
        feeBps: DEFAULT_PROXY_FEE_BPS,
        walletId: PROXY_WALLET_ID,
        receiptNsecCiphertext: encryptProxySecret(
          privateKeyHex,
          PROXY_CONFIG_ID,
          'receipt-nsec'
        ),
        receiptPubkey: publicKeyHex
      }
    ],
    skipDuplicates: true
  })

  const initialized = result.count === 1
  if (initialized) {
    log.info(
      { receiptPubkey: publicKeyHex },
      'proxy_receipt_signer.initialized'
    )
  }
  return initialized
}
