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
import { decryptProxySecret, encryptProxySecret } from '@/lib/proxy/vault'

const log = createLogger({ module: 'proxy-receipt-signer' })

/**
 * Guarantee this instance has a usable NIP-57 receipt signer.
 *
 * `getZapReceiptCapability()` is the only gate on `allowsNostr` /
 * `nostrPubkey` in the LUD-16 payRequest, and it needs both halves of the
 * signer — ciphertext and published pubkey — to resolve. Any gap there turns
 * zaps off for *every* NWC wallet on the instance, so each gap is repaired
 * here rather than reported:
 *
 * - no config row at all: create it with a fresh signer;
 * - row present but no signer: generate one (the row is created by the
 *   settings route too, which can leave the signer empty);
 * - signer readable but no published pubkey: derive it from the key;
 * - signer `NWC_VAULT_SECRET` cannot open: replace it.
 *
 * Returns whether anything was written. Every write is guarded so concurrent
 * cold starts cannot install different keys.
 */
export async function ensureZapReceiptSigner(): Promise<boolean> {
  if (!getConfig(false).nwcVault.enabled) return false

  const row = await prisma.proxyServiceConfig.findUnique({
    where: { id: PROXY_CONFIG_ID },
    select: { id: true, receiptNsecCiphertext: true, receiptPubkey: true }
  })

  if (!row) return createConfigWithSigner()
  if (!row.receiptNsecCiphertext) return installMissingSigner(row.id)

  let privateKeyHex: string | null = null
  try {
    privateKeyHex = decryptProxySecret(
      row.receiptNsecCiphertext,
      row.id,
      'receipt-nsec'
    )
  } catch {
    // Falls through to replacement below.
  }

  if (privateKeyHex) {
    if (row.receiptPubkey) return false
    return restoreMissingPubkey(row.id, privateKeyHex)
  }

  return replaceUnreadableSigner(
    row.id,
    row.receiptNsecCiphertext,
    row.receiptPubkey
  )
}

/**
 * `createMany({ skipDuplicates: true })` makes concurrent cold starts safe:
 * the loser writes nothing rather than overwriting the winner's signer.
 */
async function createConfigWithSigner(): Promise<boolean> {
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

async function installMissingSigner(id: string): Promise<boolean> {
  const privateKeyHex = generatePrivateKey()
  const publicKeyHex = receiptPubkey(privateKeyHex)
  const claimed = await prisma.proxyServiceConfig.updateMany({
    where: { id, receiptNsecCiphertext: null },
    data: {
      receiptNsecCiphertext: encryptProxySecret(
        privateKeyHex,
        id,
        'receipt-nsec'
      ),
      receiptPubkey: publicKeyHex
    }
  })
  if (claimed.count === 0) return false

  log.info(
    { proxyConfigId: id, receiptPubkey: publicKeyHex },
    'proxy_receipt_signer.generated_for_existing_config'
  )
  return true
}

async function restoreMissingPubkey(
  id: string,
  privateKeyHex: string
): Promise<boolean> {
  const publicKeyHex = receiptPubkey(privateKeyHex)
  await prisma.proxyServiceConfig.update({
    where: { id },
    data: { receiptPubkey: publicKeyHex }
  })
  log.warn(
    { proxyConfigId: id, receiptPubkey: publicKeyHex },
    'proxy_receipt_signer.pubkey_restored'
  )
  return true
}

/**
 * The displaced key is unrecoverable by anyone, so it is overwritten rather
 * than archived; the log line is the audit trail. `receiptPubkey` is
 * rewritten in the same statement so `.well-known/nostr.json` and every
 * advertised `nostrPubkey` keep matching the key that will sign receipts, and
 * the update is guarded on the ciphertext we read so concurrent cold starts
 * cannot each install a different key.
 */
async function replaceUnreadableSigner(
  id: string,
  expectedCiphertext: Uint8Array<ArrayBuffer>,
  previousPubkey: string | null
): Promise<boolean> {
  const privateKeyHex = generatePrivateKey()
  const publicKeyHex = receiptPubkey(privateKeyHex)

  const claimed = await prisma.proxyServiceConfig.updateMany({
    where: { id, receiptNsecCiphertext: expectedCiphertext },
    data: {
      receiptNsecCiphertext: encryptProxySecret(
        privateKeyHex,
        id,
        'receipt-nsec'
      ),
      receiptPubkey: publicKeyHex
    }
  })
  if (claimed.count === 0) return false

  log.warn(
    {
      proxyConfigId: id,
      previousReceiptPubkey: previousPubkey,
      receiptPubkey: publicKeyHex
    },
    'proxy_receipt_signer.replaced_unreadable'
  )
  return true
}
