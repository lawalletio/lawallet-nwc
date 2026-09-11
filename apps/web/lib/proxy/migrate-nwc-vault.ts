import { getConfig } from '@/lib/config'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { PROXY_CONFIG_ID } from '@/lib/proxy/constants'
import {
  decryptProxySecret,
  encryptProxySecret,
  isProxySecretCurrent
} from '@/lib/proxy/vault'

const log = createLogger({ module: 'proxy-nwc-vault-migration' })

/**
 * Converge `ProxyServiceConfig` secrets on what the vault writes today: the
 * `lwrw1:` envelope that already protects
 * `RemoteWallet.config.connectionString`, sealed with the active
 * `NWC_VAULT_SECRET`.
 *
 * Reads accept the legacy `LWPX01` envelope and every configured previous
 * secret, so this both finishes the format change and completes a secret
 * rotation online. Anything it opens is re-sealed under the active secret;
 * anything it cannot open is reported and left untouched — the receipt
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
    const converged = await resealField({
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
    await resealField({
      id: row.id,
      ciphertext: row.receiptNsecCiphertext,
      field: 'receipt-nsec',
      column: 'receiptNsecCiphertext'
    })
  }
}

/**
 * Rewrite one stored field under the active secret in canonical form when it
 * is not already. Returns whether the field could be read at all.
 */
async function resealField(params: {
  id: string
  ciphertext: Uint8Array
  field: 'nwc' | 'receipt-nsec'
  column: 'nwcCiphertext' | 'receiptNsecCiphertext'
}): Promise<boolean> {
  const { id, ciphertext, field, column } = params

  if (isProxySecretCurrent(ciphertext, id, field)) return true

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
  log.info({ proxyConfigId: id, field }, 'proxy.nwc_vault.resealed')
  return true
}
