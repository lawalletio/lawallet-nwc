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
import {
  decryptRemoteWalletConnectionString,
  isEncryptedRemoteWalletConnectionString
} from '@/lib/wallet/remote-wallet-vault'

const log = createLogger({ module: 'proxy-nwc-vault-migration' })

/** Rows sampled when looking for proof that the active secret is the right one. */
const PROOF_SAMPLE_SIZE = 50

/**
 * Bring `ProxyServiceConfig` onto the single `lwrw1:` envelope that already
 * protects `RemoteWallet.config.connectionString`, and make sure the NIP-57
 * receipt signer is actually usable.
 *
 * Writes always use `NWC_VAULT_SECRET`. Reads still accept the legacy
 * `LWPX01` proxy envelope so a mixed fleet can boot during the conversion.
 *
 * A receipt signer sealed under a secret this deployment no longer has turns
 * NIP-57 off for *every* NWC wallet, and no operator action can recover the
 * key itself. Since the signer is an instance identity the platform generates
 * for itself, it is replaced with a fresh key rather than left broken — but
 * only once another NWC credential has proved the active secret is correct,
 * so a temporarily misconfigured secret can never destroy a recoverable one.
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

  let secretProven = false

  if (row.nwcCiphertext) {
    const converted = await convertField({
      id: row.id,
      ciphertext: row.nwcCiphertext,
      field: 'nwc',
      column: 'nwcCiphertext'
    })
    if (converted) secretProven = true
    else {
      log.error({ proxyConfigId: row.id }, 'proxy.nwc_vault.nwc_unreadable')
    }
  }

  // A deliberately cleared signer is a supported operator choice.
  if (!row.receiptNsecCiphertext) return

  if (
    await convertField({
      id: row.id,
      ciphertext: row.receiptNsecCiphertext,
      field: 'receipt-nsec',
      column: 'receiptNsecCiphertext'
    })
  ) {
    return
  }

  if (!secretProven) {
    secretProven = await anyRemoteWalletEnvelopeOpens()
  }

  if (!secretProven) {
    log.error(
      { proxyConfigId: row.id },
      'proxy.nwc_vault.receipt_signer_unreadable_unproven'
    )
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
 * it back in canonical form. Returns whether the field could be read.
 */
async function convertField(params: {
  id: string
  ciphertext: Uint8Array
  field: 'nwc' | 'receipt-nsec'
  column: 'nwcCiphertext' | 'receiptNsecCiphertext'
}): Promise<boolean> {
  const { id, ciphertext, field, column } = params

  let plaintext: string
  try {
    plaintext = decryptProxySecret(ciphertext, id, field)
  } catch {
    return false
  }

  if (isCanonicalNwcVaultBytes(ciphertext)) return true

  await prisma.proxyServiceConfig.update({
    where: { id },
    data: { [column]: encryptProxySecret(plaintext, id, field) }
  })
  log.info({ proxyConfigId: id, field }, 'proxy.nwc_vault.converted_to_lwrw1')
  return true
}

/**
 * Proof that `NWC_VAULT_SECRET` is the secret this database was sealed with:
 * some other NWC credential opens with it. Plaintext rows prove nothing.
 */
async function anyRemoteWalletEnvelopeOpens(): Promise<boolean> {
  const wallets = await prisma.remoteWallet.findMany({
    where: { type: 'NWC' },
    select: { id: true, config: true },
    orderBy: { id: 'asc' },
    take: PROOF_SAMPLE_SIZE
  })

  for (const wallet of wallets) {
    const stored = (wallet.config as Record<string, unknown> | null)
      ?.connectionString
    if (!isEncryptedRemoteWalletConnectionString(stored)) continue
    try {
      decryptRemoteWalletConnectionString(stored, wallet.id)
      return true
    } catch {
      // Try the next wallet.
    }
  }
  return false
}

/**
 * Replace an unrecoverable receipt signer. The pubkey is rewritten in the
 * same statement so `.well-known/nostr.json` and every advertised
 * `nostrPubkey` stay consistent with the key that will sign receipts, and the
 * update is guarded on the ciphertext we read so concurrent cold starts
 * cannot each install a different key.
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
      receiptPubkey: publicKeyHex
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
