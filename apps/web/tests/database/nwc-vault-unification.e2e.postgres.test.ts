import { createCipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const databaseUrl = process.env.NWC_VAULT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

// The suite runs against the real config, so the active secret is whatever
// NWC_VAULT_SECRET this process was started with.
const ACTIVE_SECRET = process.env.NWC_VAULT_SECRET ?? ''
const RETIRED_SECRET =
  'retired-nwc-vault-secret-0123456789abcdef0123456789abcdef'

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

describe.skipIf(!runDatabaseTests)(
  'NWC credential unification and NIP-57 recovery (real Postgres)',
  () => {
    const suffix = randomUUID()
    const userId = `vault-user-${suffix}`
    const walletId = `vault-wallet-${suffix}`
    const plaintextWalletId = `vault-plain-${suffix}`
    const retiredNsec = generatePrivateKey()
    const retiredPubkey = receiptPubkey(retiredNsec)

    beforeAll(async () => {
      getListenerConfig.mockResolvedValue({
        enabled: true,
        url: 'http://listener.test'
      })

      // ProxyServiceConfig is a fixed-id singleton, so any vault test has to
      // own it. Everything else is suffixed and cleaned up in afterAll.
      await prisma.proxyServiceConfig.deleteMany({
        where: { id: PROXY_CONFIG_ID }
      })

      const pubkey = (randomUUID() + randomUUID())
        .replaceAll('-', '')
        .slice(0, 64)
      await prisma.user.create({ data: { id: userId, pubkey } })

      // A wallet already sealed under the active secret: this is the proof
      // that makes replacing the unreadable signer safe.
      await prisma.remoteWallet.create({
        data: {
          id: walletId,
          userId,
          name: `Sealed-${suffix}`,
          type: 'NWC',
          config: {
            connectionString: encryptRemoteWalletEnvelope(
              NWC_URI,
              walletId,
              ACTIVE_SECRET
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

      // Production shape: proxy NWC still in the legacy envelope under the
      // active secret, receipt signer sealed under a secret that is gone.
      await prisma.proxyServiceConfig.create({
        data: {
          id: PROXY_CONFIG_ID,
          walletId: `proxy-${suffix}`,
          enabled: false,
          nwcCiphertext: legacyProxyEnvelope(NWC_URI, 'nwc', ACTIVE_SECRET),
          receiptNsecCiphertext: legacyProxyEnvelope(
            retiredNsec,
            'receipt-nsec',
            RETIRED_SECRET
          ),
          receiptPubkey: retiredPubkey
        }
      })
    })

    afterAll(async () => {
      if (!runDatabaseTests) return
      await prisma.remoteWallet.deleteMany({
        where: { id: { in: [walletId, plaintextWalletId] } }
      })
      await prisma.user.deleteMany({ where: { id: userId } })
      await prisma.proxyServiceConfig.deleteMany({
        where: { id: PROXY_CONFIG_ID }
      })
    })

    it('reproduces the outage: no signer, so NIP-57 is advertised nowhere', async () => {
      expect(await getZapReceiptSigner()).toBeNull()
      const capability = await getZapReceiptCapability()
      expect(capability.nip57).toBe(false)
      expect(capability.receiptPubkey).toBeNull()
    })

    it('stores every NWC credential in the one canonical envelope', async () => {
      await migrateRemoteWalletNwcConfigs()
      await migrateProxyNwcVault()

      const wallets = await prisma.remoteWallet.findMany({
        where: { id: { in: [walletId, plaintextWalletId] } },
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
    })

    it('restores NIP-57 for every NWC wallet with a usable signer', async () => {
      const signer = await getZapReceiptSigner()
      expect(signer).not.toBeNull()

      const proxy = await prisma.proxyServiceConfig.findUniqueOrThrow({
        where: { id: PROXY_CONFIG_ID }
      })
      // The unrecoverable key was replaced, and the advertised pubkey moved
      // with it so receipts verify against what payers are told.
      expect(proxy.receiptPubkey).not.toBe(retiredPubkey)
      expect(signer!.pubkey).toBe(proxy.receiptPubkey)
      expect(receiptPubkey(signer!.privateKeyHex)).toBe(proxy.receiptPubkey)

      const capability = await getZapReceiptCapability()
      expect(capability.nip57).toBe(true)
      expect(capability.receiptPubkey).toBe(proxy.receiptPubkey)
      expect(capability.reason).toBeNull()
    })

    it('is idempotent: a second boot changes nothing', async () => {
      const before = await prisma.proxyServiceConfig.findUniqueOrThrow({
        where: { id: PROXY_CONFIG_ID }
      })

      await migrateRemoteWalletNwcConfigs()
      await migrateProxyNwcVault()

      const after = await prisma.proxyServiceConfig.findUniqueOrThrow({
        where: { id: PROXY_CONFIG_ID }
      })
      expect(after.receiptPubkey).toBe(before.receiptPubkey)
      expect(Buffer.from(after.receiptNsecCiphertext!)).toEqual(
        Buffer.from(before.receiptNsecCiphertext!)
      )
      expect(Buffer.from(after.nwcCiphertext!)).toEqual(
        Buffer.from(before.nwcCiphertext!)
      )
    })
  }
)
