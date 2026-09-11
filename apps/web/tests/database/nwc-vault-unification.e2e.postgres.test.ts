import { createCipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const databaseUrl = process.env.NWC_VAULT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

// The suite drives the real env → config plumbing, so the vault secret is
// whatever NWC_VAULT_SECRET this process was started with.
const ACTIVE_SECRET = process.env.NWC_VAULT_SECRET ?? ''
const LOST_SECRET = 'lost-nwc-vault-secret-0123456789abcdef0123456789abcdef'

// Only the listener bridge is stubbed — NIP-57 legitimately requires a
// listener to observe settlement, and there is no relay in this environment.
// Every vault read/write, the startup passes, and the capability gate run
// against the real Postgres with real AES-256-GCM.
const { getListenerConfig } = vi.hoisted(() => ({
  getListenerConfig: vi.fn()
}))

vi.mock('@/lib/listener-config', async importActual => ({
  ...(await importActual<typeof import('@/lib/listener-config')>()),
  getListenerConfig
}))

import { prisma } from '@/lib/prisma'
import {
  getZapReceiptCapability,
  getZapReceiptSigner
} from '@/lib/nostr/zap-receipts'
import { PROXY_CONFIG_ID } from '@/lib/proxy/constants'
import { generatePrivateKey } from '@/lib/nostr'
import { receiptPubkey } from '@/lib/proxy/nostr'
import { ensureZapReceiptSigner } from '@/lib/proxy/initialize-receipt-signer'
import { migrateProxyNwcVault } from '@/lib/proxy/migrate-nwc-vault'
import { migrateRemoteWalletNwcConfigs } from '@/lib/wallet/migrate-remote-wallet-vault'
import { decryptRemoteWalletConfig } from '@/lib/wallet/remote-wallet-vault'

const NWC_URI =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' +
  'b'.repeat(64)

/** The pre-unification proxy envelope: raw `LWPX01` bytes, its own HKDF info. */
function legacyProxyEnvelope(
  plaintext: string,
  field: string,
  secret: string
): Uint8Array<ArrayBuffer> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = Buffer.from(
    hkdfSync('sha256', secret, salt, 'lawallet-proxy-vault-v1', 32)
  )
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${PROXY_CONFIG_ID}:${field}`, 'utf8'))
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final()
  ])
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from('LWPX01', 'utf8'),
      salt,
      iv,
      cipher.getAuthTag(),
      ciphertext
    ])
  )
}

function isCanonical(value: Uint8Array | null): boolean {
  return !!value && Buffer.from(value).toString('utf8').startsWith('lwrw1:')
}

async function runStartupPasses(): Promise<void> {
  await migrateRemoteWalletNwcConfigs()
  await migrateProxyNwcVault()
  await ensureZapReceiptSigner()
}

describe.skipIf(!runDatabaseTests)(
  'NWC credential unification and NIP-57 recovery (real Postgres)',
  () => {
    const suffix = randomUUID()
    const userId = `vault-user-${suffix}`
    const walletId = `vault-wallet-${suffix}`
    const originalNsec = generatePrivateKey()
    const originalPubkey = receiptPubkey(originalNsec)

    async function seedProxyConfig(
      receiptNsecCiphertext: Uint8Array<ArrayBuffer> | null,
      receiptPubkeyValue: string | null
    ): Promise<void> {
      await prisma.proxyServiceConfig.deleteMany({
        where: { id: PROXY_CONFIG_ID }
      })
      await prisma.proxyServiceConfig.create({
        data: {
          id: PROXY_CONFIG_ID,
          walletId: `proxy-${suffix}`,
          enabled: false,
          nwcCiphertext: legacyProxyEnvelope(NWC_URI, 'nwc', ACTIVE_SECRET),
          receiptNsecCiphertext,
          receiptPubkey: receiptPubkeyValue
        }
      })
    }

    beforeAll(async () => {
      getListenerConfig.mockResolvedValue({
        enabled: true,
        url: 'http://listener.test'
      })

      const pubkey = (randomUUID() + randomUUID())
        .replaceAll('-', '')
        .slice(0, 64)
      await prisma.user.create({ data: { id: userId, pubkey } })

      // A pre-vault plaintext row the startup pass must encrypt.
      await prisma.remoteWallet.create({
        data: {
          id: walletId,
          userId,
          name: `Plaintext-${suffix}`,
          type: 'NWC',
          config: { connectionString: NWC_URI, mode: 'SEND_RECEIVE' },
          nwcConfigEncryptedAt: null,
          status: 'ACTIVE',
          isDefault: true
        }
      })
    })

    afterAll(async () => {
      if (!runDatabaseTests) return
      await prisma.remoteWallet.deleteMany({ where: { id: walletId } })
      await prisma.user.deleteMany({ where: { id: userId } })
      await prisma.proxyServiceConfig.deleteMany({
        where: { id: PROXY_CONFIG_ID }
      })
    })

    it('reproduces the outage: an unopenable signer hides NIP-57 everywhere', async () => {
      await seedProxyConfig(
        legacyProxyEnvelope(originalNsec, 'receipt-nsec', LOST_SECRET),
        originalPubkey
      )

      expect(await getZapReceiptSigner()).toBeNull()
      const capability = await getZapReceiptCapability()
      expect(capability.nip57).toBe(false)
      expect(capability.receiptPubkey).toBeNull()
    })

    it('restores NIP-57 for every NWC wallet on the next boot', async () => {
      await runStartupPasses()

      const signer = await getZapReceiptSigner()
      expect(signer).not.toBeNull()

      const proxy = await prisma.proxyServiceConfig.findUniqueOrThrow({
        where: { id: PROXY_CONFIG_ID }
      })
      // The advertised pubkey moved with the key, so receipts verify against
      // what payers are told.
      expect(signer!.pubkey).toBe(proxy.receiptPubkey)
      expect(receiptPubkey(signer!.privateKeyHex)).toBe(proxy.receiptPubkey)

      const capability = await getZapReceiptCapability()
      expect(capability.nip57).toBe(true)
      expect(capability.receiptPubkey).toBe(proxy.receiptPubkey)
      expect(capability.reason).toBeNull()
    })

    it('stores every NWC credential in the one canonical envelope', async () => {
      const wallet = await prisma.remoteWallet.findUniqueOrThrow({
        where: { id: walletId },
        select: {
          id: true,
          type: true,
          config: true,
          nwcConfigEncryptedAt: true
        }
      })
      const stored = (wallet.config as Record<string, unknown>).connectionString
      expect(String(stored).startsWith('lwrw1:')).toBe(true)
      expect(wallet.nwcConfigEncryptedAt).not.toBeNull()
      expect(
        decryptRemoteWalletConfig(wallet.id, wallet.type, wallet.config)
          .connectionString
      ).toBe(NWC_URI)

      const proxy = await prisma.proxyServiceConfig.findUniqueOrThrow({
        where: { id: PROXY_CONFIG_ID }
      })
      expect(isCanonical(proxy.nwcCiphertext)).toBe(true)
      expect(isCanonical(proxy.receiptNsecCiphertext)).toBe(true)
    })

    it('retains the displaced signer so the old identity stays recoverable', async () => {
      const proxy = await prisma.proxyServiceConfig.findUniqueOrThrow({
        where: { id: PROXY_CONFIG_ID }
      })
      expect(proxy.receiptPubkeyRetired).toBe(originalPubkey)
      expect(proxy.receiptSignerReplacedAt).not.toBeNull()
      expect(proxy.receiptNsecRetiredCiphertext).not.toBeNull()
    })

    it('generates a signer for a config row that has none', async () => {
      await seedProxyConfig(null, null)
      expect(await getZapReceiptSigner()).toBeNull()

      await ensureZapReceiptSigner()

      expect(await getZapReceiptSigner()).not.toBeNull()
      expect((await getZapReceiptCapability()).nip57).toBe(true)
    })

    it('is idempotent: a second boot does not churn the signer', async () => {
      // Converge first — the preceding test re-seeded a legacy envelope, and
      // converting that is a legitimate one-time write.
      await runStartupPasses()
      const before = await prisma.proxyServiceConfig.findUniqueOrThrow({
        where: { id: PROXY_CONFIG_ID }
      })

      await runStartupPasses()

      const after = await prisma.proxyServiceConfig.findUniqueOrThrow({
        where: { id: PROXY_CONFIG_ID }
      })
      expect(after.receiptPubkey).toBe(before.receiptPubkey)
      expect(after.receiptSignerReplacedAt).toEqual(
        before.receiptSignerReplacedAt
      )
      expect(Buffer.from(after.receiptNsecCiphertext!)).toEqual(
        Buffer.from(before.receiptNsecCiphertext!)
      )
      expect(Buffer.from(after.nwcCiphertext!)).toEqual(
        Buffer.from(before.nwcCiphertext!)
      )
    })
  }
)
