import { getConfig } from '@/lib/config'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { PROXY_CONFIG_ID } from '@/lib/proxy/constants'
import {
  decryptProxySecret,
  encryptProxySecret,
  isCanonicalNwcVaultBytes
} from '@/lib/proxy/vault'

const log = createLogger({ module: 'proxy-nwc-vault-migration' })

/**
 * Converge `ProxyServiceConfig` secrets on the `lwrw1:` envelope that already
 * protects `RemoteWallet.config.connectionString`.
 *
 * Reads still accept the legacy `LWPX01` envelope so a mixed fleet can boot
 * during the change; anything that opens is rewritten in canonical form.
 * Anything that does not is reported and left untouched — the receipt
 * signer's own repair is `ensureZapReceiptSigner`, which runs next.
 */
export async function migrateProxyNwcVault(): Promise<void> {
  const { secret } = getConfig().nwcVault
  // A missing vault secret is already fatal when NWC wallets exist; the proxy
  // row simply stays dormant otherwise.
  if (!secret) return

  const row = await prisma.proxyServiceConfig.findUnique({
    where: { id: PROXY_CONFIG_ID },
    select: { id: true, nwcCiphertext: true, receiptNsecCiphertext: true }
  })
  if (!row) return

  if (row.nwcCiphertext) {
    const converged = await convertField({
      id: row.id,
      ciphertext: row.nwcCiphertext,
      field: 'nwc',
      column: 'nwcCiphertext'
    })
    if (!converged) {
      log.error({ proxyConfigId: row.id }, 'proxy.nwc_vault.nwc_unreadable')
    }
  }

  if (row.receiptNsecCiphertext) {
    await convertField({
      id: row.id,
      ciphertext: row.receiptNsecCiphertext,
      field: 'receipt-nsec',
      column: 'receiptNsecCiphertext'
    })
  }
}

/**
 * Rewrite one stored field in canonical form when it is still legacy.
 * Returns whether the field could be read at all.
 */
async function convertField(params: {
  id: string
  ciphertext: Uint8Array
  field: 'nwc' | 'receipt-nsec'
  column: 'nwcCiphertext' | 'receiptNsecCiphertext'
}): Promise<boolean> {
  const { id, ciphertext, field, column } = params

  if (isCanonicalNwcVaultBytes(ciphertext)) {
    // Already canonical: confirm it opens, but never rewrite (a new salt
    // would make every boot a write).
    try {
      decryptProxySecret(ciphertext, id, field)
      return true
    } catch {
      return false
    }
  }

  let plaintext: string
  try {
    plaintext = decryptProxySecret(ciphertext, id, field)
  } catch {
    return false
  }

  await prisma.proxyServiceConfig.update({
    where: { id },
    data: { [column]: encryptProxySecret(plaintext, id, field) }
  })
  log.info({ proxyConfigId: id, field }, 'proxy.nwc_vault.converted_to_lwrw1')
  return true
}
