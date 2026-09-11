import { createCipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const databaseUrl = process.env.NWC_VAULT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

// The suite drives the real env → config plumbing, so the active secret is
// whatever NWC_VAULT_SECRET this process was started with.
const ACTIVE_SECRET = process.env.NWC_VAULT_SECRET ?? ''
const RETIRED_SECRET =
  'retired-nwc-vault-secret-0123456789abcdef0123456789abcdef'
const LOST_SECRET = 'lost-nwc-vault-secret-0123456789abcdef0123456789abcdef'

// Only the listener bridge is stubbed — NIP-57 legitimately requires a
// listener to observe settlement, and there is no relay in this environment.
// Every vault read/write, the startup passes, and the capability gate run
// against the real Postgres with real AES-256-GCM.
const { getListenerConfig, vault } = vi.hoisted(() => ({
  getListenerConfig: vi.fn(),
  // `getEnv()` memoizes independently of `resetConfig()`, so the secret chain
  // is injected here rather than through process.env.
  vault: { secret: '', previousSecrets: [] as string[] }
}))

vi.mock('@/lib/listener-config', async importActual => ({
  ...(await importActual<typeof import('@/lib/listener-config')>()),
  getListenerConfig
}))

vi.mock('@/lib/config', async importActual => {
  const actual = await importActual<typeof import('@/lib/config')>()
  return {
    ...actual,
    getConfig: (strict?: boolean) => ({
      ...actual.getConfig(strict),
      nwcVault: {
        secret: vault.secret || undefined,
        previousSecrets: vault.previousSecrets,
        enabled: !!vault.secret
      }
    })
  }
})

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
import { encryptRemoteWalletEnvelope } from '@/lib/wallet/remote-wallet-vault-core'

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

/** Mirrors what `NWC_VAULT_SECRET_PREVIOUS` resolves to. */
function setPreviousSecrets(...secrets: string[]): void {
  vault.previousSecrets = secrets
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
    const staleWalletId = `vault-stale-${suffix}`
    const plaintextWalletId = `vault-plain-${suffix}`
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
          // Legacy format, current secret: only the envelope needs changing.
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
      vault.secret = ACTIVE_SECRET
      setPreviousSecrets()

      const pubkey = (randomUUID() + randomUUID())
        .replaceAll('-', '')
        .slice(0, 64)
      await prisma.user.create({ data: { id: userId, pubkey } })

      // Canonical envelope, retired secret: the rotation case.
      await prisma.remoteWallet.create({
        data: {
          id: staleWalletId,
          userId,
          name: `Stale-${suffix}`,
          type: 'NWC',
          config: {
            connectionString: encryptRemoteWalletEnvelope(
              NWC_URI,
              staleWalletId,
              RETIRED_SECRET
            ),
            mode: 'SEND_RECEIVE'
          },
          nwcConfigEncryptedAt: new Date(),
          status: 'ACTIVE',
          isDefault: true
        }
      })

      // A pre-vault plaintext row the startup pass must encrypt.
      await prisma.remoteWallet.create({
        data: {
          id: plaintextWalletId,
          userId,
          name: `Plaintext-${suffix}`,
          type: 'NWC',
          config: { connectionString: NWC_URI, mode: 'RECEIVE' },
          nwcConfigEncryptedAt: null,
          status: 'ACTIVE',
          isDefault: false
        }
      })
    })

    afterAll(async () => {
      if (!runDatabaseTests) return
      setPreviousSecrets()
      await prisma.remoteWallet.deleteMany({
        where: { id: { in: [staleWalletId, plaintextWalletId] } }
      })
      await prisma.user.deleteMany({ where: { id: userId } })
      await prisma.proxyServiceConfig.deleteMany({
        where: { id: PROXY_CONFIG_ID }
      })
    })

    it('reproduces the outage: a rotated secret hides the signer entirely', async () => {
      await seedProxyConfig(
        legacyProxyEnvelope(originalNsec, 'receipt-nsec', RETIRED_SECRET),
        originalPubkey
      )

      expect(await getZapReceiptSigner()).toBeNull()
      const capability = await getZapReceiptCapability()
      expect(capability.nip57).toBe(false)
      expect(capability.receiptPubkey).toBeNull()
    })

    it('recovers the original key from NWC_VAULT_SECRET_PREVIOUS, unchanged', async () => {
      setPreviousSecrets(RETIRED_SECRET)

      const signer = await getZapReceiptSigner()
      expect(signer?.privateKeyHex).toBe(originalNsec)
      // Same key, so the instance keeps the `_` identity it published.
      expect(signer?.pubkey).toBe(originalPubkey)

      const capability = await getZapReceiptCapability()
      expect(capability.nip57).toBe(true)
      expect(capability.receiptPubkey).toBe(originalPubkey)
    })

    it('re-seals every credential under the active secret', async () => {
      await runStartupPasses()

      const wallets = await prisma.remoteWallet.findMany({
        where: { id: { in: [staleWalletId, plaintextWalletId] } },
        select: { id: true, config: true, nwcConfigEncryptedAt: true }
      })
      expect(wallets).toHaveLength(2)
      for (const wallet of wallets) {
        const stored = (wallet.config as Record<string, unknown>)
          .connectionString
        expect(String(stored).startsWith('lwrw1:')).toBe(true)
        expect(wallet.nwcConfigEncryptedAt).not.toBeNull()
      }

      const proxy = await prisma.proxyServiceConfig.findUniqueOrThrow({
        where: { id: PROXY_CONFIG_ID }
      })
      expect(isCanonical(proxy.nwcCiphertext)).toBe(true)
      expect(isCanonical(proxy.receiptNsecCiphertext)).toBe(true)
      // Recovered, not replaced.
      expect(proxy.receiptPubkey).toBe(originalPubkey)
      expect(proxy.receiptSignerReplacedAt).toBeNull()
    })

    it('keeps NIP-57 working once the previous secret is dropped', async () => {
      // The point of re-sealing: the rotation is complete, so the operator can
      // remove NWC_VAULT_SECRET_PREVIOUS.
      setPreviousSecrets()

      const signer = await getZapReceiptSigner()
      expect(signer?.privateKeyHex).toBe(originalNsec)

      const capability = await getZapReceiptCapability()
      expect(capability.nip57).toBe(true)
      expect(capability.receiptPubkey).toBe(originalPubkey)

      const wallet = await prisma.remoteWallet.findUniqueOrThrow({
        where: { id: staleWalletId },
        select: { id: true, type: true, config: true }
      })
      const { decryptRemoteWalletConfig } =
        await import('@/lib/wallet/remote-wallet-vault')
      expect(
        decryptRemoteWalletConfig(wallet.id, wallet.type, wallet.config)
          .connectionString
      ).toBe(NWC_URI)
    })

    it('generates a signer for a config row that has none', async () => {
      await seedProxyConfig(null, null)
      expect(await getZapReceiptSigner()).toBeNull()

      await ensureZapReceiptSigner()

      const signer = await getZapReceiptSigner()
      expect(signer).not.toBeNull()
      expect((await getZapReceiptCapability()).nip57).toBe(true)
    })

    it('replaces a signer no configured secret can open, retaining it', async () => {
      const lost = legacyProxyEnvelope(
        originalNsec,
        'receipt-nsec',
        LOST_SECRET
      )
      await seedProxyConfig(lost, originalPubkey)
      expect(await getZapReceiptSigner()).toBeNull()

      await runStartupPasses()

      const signer = await getZapReceiptSigner()
      expect(signer).not.toBeNull()
      expect(signer!.privateKeyHex).not.toBe(originalNsec)

      const proxy = await prisma.proxyServiceConfig.findUniqueOrThrow({
        where: { id: PROXY_CONFIG_ID }
      })
      expect(signer!.pubkey).toBe(proxy.receiptPubkey)
      expect(receiptPubkey(signer!.privateKeyHex)).toBe(proxy.receiptPubkey)
      expect((await getZapReceiptCapability()).nip57).toBe(true)

      // Byte-identical, so restoring the lost secret still recovers it.
      expect(Buffer.from(proxy.receiptNsecRetiredCiphertext!)).toEqual(
        Buffer.from(lost)
      )
      expect(proxy.receiptPubkeyRetired).toBe(originalPubkey)
      expect(proxy.receiptSignerReplacedAt).not.toBeNull()
    })

    it('is idempotent: a second boot does not churn the signer', async () => {
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
