import { getConfig } from '@/lib/config'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  decryptProxySecret,
  encryptProxySecret,
  isCanonicalNwcVaultBytes,
  ProxyVaultDecryptError
} from '@/lib/proxy/vault'

const log = createLogger({ module: 'proxy-nwc-vault-migration' })

/**
 * Re-seal `ProxyServiceConfig` NWC URI and receipt nsec into the same
 * `lwrw1:` envelope used by `RemoteWallet.config.connectionString`.
 *
 * Writes always use `NWC_VAULT_SECRET`. Reads still accept legacy `LWPX01`
 * so a mixed fleet can boot while this conversion lands.
 *
 * Receipt nsec that fails to decrypt is logged and left in place — that is
 * the current NIP-57 degrade path. Proxy NWC that exists but cannot be
 * read with the current secret fails boot.
 */
export async function migrateProxyNwcVault(): Promise<void> {
  const row = await prisma.proxyServiceConfig.findUnique({
    where: { id: 'default' },
    select: {
      id: true,
      nwcCiphertext: true,
      receiptNsecCiphertext: true
    }
  })

  if (!row) {
    return
  }

  const secret = getConfig().nwcVault.secret
  const hasCiphertext = Boolean(row.nwcCiphertext || row.receiptNsecCiphertext)

  if (hasCiphertext && !secret) {
    throw new Error(
      'ProxyServiceConfig ciphertext is set but NWC_VAULT_SECRET is not configured. Set the vault secret before starting the web app.'
    )
  }

  if (!secret) {
    return
  }

  if (row.nwcCiphertext) {
    await convertOrVerifyProxyField({
      id: row.id,
      ciphertext: row.nwcCiphertext,
      field: 'nwc',
      column: 'nwcCiphertext',
      failOnDecrypt: true
    })
  }

  if (row.receiptNsecCiphertext) {
    await convertOrVerifyProxyField({
      id: row.id,
      ciphertext: row.receiptNsecCiphertext,
      field: 'receipt-nsec',
      column: 'receiptNsecCiphertext',
      failOnDecrypt: false
    })
  }
}

async function convertOrVerifyProxyField(params: {
  id: string
  ciphertext: Uint8Array
  field: 'nwc' | 'receipt-nsec'
  column: 'nwcCiphertext' | 'receiptNsecCiphertext'
  failOnDecrypt: boolean
}): Promise<void> {
  const { id, ciphertext, field, column, failOnDecrypt } = params

  let plaintext: string
  try {
    plaintext = decryptProxySecret(ciphertext, id, field)
  } catch (error) {
    if (!failOnDecrypt) {
      log.warn(
        {
          err: error,
          proxyConfigId: id,
          field
        },
        'proxy.nwc_vault.skip_unreadable_field'
      )
      return
    }

    if (error instanceof ProxyVaultDecryptError) {
      throw new Error(
        `ProxyServiceConfig.${column} cannot be decrypted with the current NWC_VAULT_SECRET. Restore the secret that sealed this row.`,
        { cause: error }
      )
    }

    throw error
  }

  if (isCanonicalNwcVaultBytes(ciphertext)) {
    return
  }

  await prisma.proxyServiceConfig.update({
    where: { id },
    data: {
      [column]: encryptProxySecret(plaintext, id, field)
    }
  })

  log.info({ proxyConfigId: id, field }, 'proxy.nwc_vault.converted_to_lwrw1')
}
