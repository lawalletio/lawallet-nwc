import { getConfig } from '@/lib/config'
import { createLogger } from '@/lib/logger'
import { generatePrivateKey } from '@/lib/nostr'
import { prisma } from '@/lib/prisma'
import { PROXY_CONFIG_ID } from '@/lib/proxy/constants'
import { receiptPubkey } from '@/lib/proxy/nostr'
import {
  decryptProxySecret,
  encryptProxySecret,
  isCanonicalNwcVaultBytes
} from '@/lib/proxy/vault'

const log = createLogger({ module: 'proxy-nwc-vault-migration' })

/**
 * Bring `ProxyServiceConfig` onto the single `lwrw1:` envelope that already
 * protects `RemoteWallet.config.connectionString`, and guarantee the NIP-57
 * receipt signer is usable before this instance serves traffic.
 *
 * Writes always use `NWC_VAULT_SECRET`. Reads still accept the legacy
 * `LWPX01` proxy envelope so a mixed fleet can boot during the conversion.
 *
 * `getZapReceiptCapability()` is the only gate on `allowsNostr` /
 * `nostrPubkey` in the LUD-16 payRequest, so one unreadable signer turns zaps
 * off for *every* NWC wallet on the instance. The signer is a key the
 * platform generates for itself and an unreadable one is recoverable by
 * nobody, so it is replaced unconditionally — the displaced ciphertext is
 * retained rather than overwritten, which is what makes "unconditionally"
 * safe even when the deployment is booting with the wrong secret.
 */
export async function migrateProxyNwcVault(): Promise<void> {
  const secret = getConfig().nwcVault.secret
  // A missing vault secret is already fatal when NWC wallets exist; the proxy
  // row simply stays dormant otherwise.
  if (!secret) return

  const row = await prisma.proxyServiceConfig.findUnique({
    where: { id: PROXY_CONFIG_ID },
    select: {
      id: true,
      nwcCiphertext: true,
      receiptNsecCiphertext: true,
      receiptPubkey: true
    }
  })
  if (!row) return

  if (row.nwcCiphertext) {
    const plaintext = await convertField({
      id: row.id,
      ciphertext: row.nwcCiphertext,
      field: 'nwc',
      column: 'nwcCiphertext'
    })
    if (plaintext === null) {
      log.error({ proxyConfigId: row.id }, 'proxy.nwc_vault.nwc_unreadable')
    }
  }

  // Both columns null is the operator having deliberately cleared the signer
  // through settings, which is the only supported way to turn zaps off.
  if (!row.receiptNsecCiphertext) return

  const nsec = await convertField({
    id: row.id,
    ciphertext: row.receiptNsecCiphertext,
    field: 'receipt-nsec',
    column: 'receiptNsecCiphertext'
  })

  if (nsec !== null) {
    // A readable signer with no published pubkey is still unusable, and the
    // pubkey is derivable, so repair it rather than replacing the key.
    if (!row.receiptPubkey) {
      await prisma.proxyServiceConfig.update({
        where: { id: row.id },
        data: { receiptPubkey: receiptPubkey(nsec) }
      })
      log.warn(
        { proxyConfigId: row.id, receiptPubkey: receiptPubkey(nsec) },
        'proxy.receipt_signer.pubkey_restored'
      )
    }
    return
  }

  await replaceReceiptSigner(
    row.id,
    row.receiptNsecCiphertext,
    row.receiptPubkey
  )
}

/**
 * Decrypt one stored field and, when it is still in a legacy envelope, write
 * it back in canonical form. Returns the plaintext, or null when the active
 * secret cannot open it.
 */
async function convertField(params: {
  id: string
  ciphertext: Uint8Array
  field: 'nwc' | 'receipt-nsec'
  column: 'nwcCiphertext' | 'receiptNsecCiphertext'
}): Promise<string | null> {
  const { id, ciphertext, field, column } = params

  let plaintext: string
  try {
    plaintext = decryptProxySecret(ciphertext, id, field)
  } catch {
    return null
  }

  if (isCanonicalNwcVaultBytes(ciphertext)) return plaintext

  await prisma.proxyServiceConfig.update({
    where: { id },
    data: { [column]: encryptProxySecret(plaintext, id, field) }
  })
  log.info({ proxyConfigId: id, field }, 'proxy.nwc_vault.converted_to_lwrw1')
  return plaintext
}

/**
 * Install a working receipt signer in place of one that cannot be decrypted.
 *
 * The displaced ciphertext moves to `receiptNsecRetiredCiphertext` instead of
 * being overwritten, so restoring the secret that sealed it can still recover
 * the instance's original `_` identity. `receiptPubkey` is rewritten in the
 * same statement so `.well-known/nostr.json` and every advertised
 * `nostrPubkey` keep matching the key that will sign receipts, and the update
 * is guarded on the ciphertext we read so concurrent cold starts cannot each
 * install a different key.
 */
async function replaceReceiptSigner(
  id: string,
  expectedCiphertext: Uint8Array<ArrayBuffer>,
  previousPubkey: string | null
): Promise<void> {
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
      receiptPubkey: publicKeyHex,
      receiptNsecRetiredCiphertext: expectedCiphertext,
      receiptPubkeyRetired: previousPubkey,
      receiptSignerReplacedAt: new Date()
    }
  })
  if (claimed.count === 0) return

  log.warn(
    {
      proxyConfigId: id,
      previousReceiptPubkey: previousPubkey,
      receiptPubkey: publicKeyHex
    },
    'proxy.receipt_signer.replaced_unreadable'
  )
}
