import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const databaseUrl = process.env.CARD_PAYMENT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

// Real HTTP replay would require an NWC relay; the listener bridge is the only
// network hop the sweep makes, so it (and the vault/relay cache it depends on)
// are the seam we stub. Everything else — Prisma, the route handler, the
// forwarding service's `captureForwardingReceipt`, the advisory transaction
// lock — runs against the real Postgres.
const {
  authenticate,
  resolveListenerBridge,
  listenerNwcRequest,
  getServerNwcClient,
  decryptRemoteWalletConfig,
  getZapReceiptCapability
} = vi.hoisted(() => ({
  authenticate: vi.fn(),
  resolveListenerBridge: vi.fn(),
  listenerNwcRequest: vi.fn(),
  getServerNwcClient: vi.fn(),
  decryptRemoteWalletConfig: vi.fn(),
  getZapReceiptCapability: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', async importActual => ({
  ...(await importActual<typeof import('@/lib/auth/unified-auth')>()),
  authenticate
}))

vi.mock('@/lib/wallet/drivers/listener-transport', async importActual => ({
  ...(await importActual<
    typeof import('@/lib/wallet/drivers/listener-transport')
  >()),
  resolveListenerBridge,
  listenerNwcRequest
}))

vi.mock('@/lib/wallet/drivers/nwc-client-cache', () => ({
  getServerNwcClient
}))

vi.mock('@/lib/wallet/remote-wallet-vault', () => ({
  decryptRemoteWalletConfig
}))

vi.mock('@/lib/nostr/zap-receipts', () => ({
  getZapReceiptCapability
}))

import { prisma } from '@/lib/prisma'
import { PATCH as patchHandler } from '@/app/api/remote-wallets/[id]/route'
import { sweepMissedPayments } from '@/lib/remote-wallet-forwarding/capture-sweep'
import { setReceiveActionEnabled } from '@/lib/remote-wallet-forwarding/service'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

const hash = (c: string) => c.repeat(64)
const DAY = 24 * 60 * 60 * 1000

describe.skipIf(!runDatabaseTests)(
  'PATCH /api/remote-wallets/[id] pauses forwarding before the isDefault early return (real Postgres)',
  () => {
    const suffix = randomUUID()
    const userId = `e2e-user-${suffix}`
    const pubkey = (randomUUID() + randomUUID())
      .replaceAll('-', '')
      .slice(0, 64)
    const primaryUsername = `alice-${suffix}`
    const walletId = `e2e-wallet-${suffix}`
    const walletName = `E2E-${suffix}`
    const T0 = new Date(Date.now() - 3 * DAY)
    const disabledWindowPayment = {
      type: 'incoming',
      amount: 100_000,
      payment_hash: hash('a'),
      invoice: 'lnbc1source',
      settled_at: Math.floor((T0.getTime() + 60 * 60 * 1000) / 1000)
    }

    beforeAll(async () => {
      resolveListenerBridge.mockResolvedValue({
        enabled: true,
        url: 'http://listener.test'
      })
      listenerNwcRequest.mockResolvedValue({ transactions: [] })
      getServerNwcClient.mockResolvedValue({
        listTransactions: vi.fn().mockResolvedValue({ transactions: [] })
      })
      decryptRemoteWalletConfig.mockReturnValue({
        connectionString: 'nostr+walletconnect://test'
      })
      getZapReceiptCapability.mockResolvedValue({
        lud21: true,
        nip57: false,
        receiptPubkey: null,
        reason: null
      })
      authenticate.mockResolvedValue({
        pubkey,
        role: 'USER' as never,
        method: 'jwt' as never
      })

      await prisma.user.create({ data: { id: userId, pubkey } })
      await prisma.lightningAddress.create({
        data: {
          username: primaryUsername,
          userId,
          isPrimary: true,
          mode: 'IDLE'
        }
      })
      await prisma.remoteWallet.create({
        data: {
          id: walletId,
          userId,
          name: walletName,
          type: 'NWC',
          config: {
            connectionString: 'nostr+walletconnect://test',
            mode: 'SEND_RECEIVE'
          },
          status: 'ACTIVE',
          isDefault: false
        }
      })
      const action = await prisma.remoteWalletReceiveAction.create({
        data: {
          remoteWalletId: walletId,
          enabled: false
        }
      })
      const revision = await prisma.remoteWalletReceiveActionRevision.create({
        data: {
          actionId: action.id,
          revision: 1,
          feeBps: 50,
          baseFeeMsats: BigInt(1000),
          destinations: {
            create: [
              {
                position: 0,
                address: 'alice@example.com',
                allocationBps: 10_000
              }
            ]
          }
        }
      })
      await prisma.remoteWalletReceiveAction.update({
        where: { id: action.id },
        data: {
          currentRevisionId: revision.id,
          enabled: true,
          enabledAt: T0,
          pausedAt: null
        }
      })
    })

    afterAll(async () => {
      await prisma.remoteWalletForwardReceipt
        .deleteMany({
          where: { walletId }
        })
        .catch(() => undefined)
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
      await prisma.$disconnect()
    })

    it('pauses the action on PATCH { isDefault: true, status: DISABLED } and stops the sweep from retro-capturing disabled-window payments', async () => {
      const res = await patchHandler(
        createNextRequest(`/api/remote-wallets/${walletId}`, {
          method: 'PATCH',
          body: { isDefault: true, status: 'DISABLED' }
        }),
        createParamsPromise({ id: walletId })
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string; isDefault: boolean }
      expect(body.status).toBe('DISABLED')
      expect(body.isDefault).toBe(true)

      const actionAfter = await prisma.remoteWalletReceiveAction.findUnique({
        where: { remoteWalletId: walletId }
      })
      expect(actionAfter?.enabled).toBe(false)
      expect(actionAfter?.pausedAt).not.toBeNull()
      expect(actionAfter?.enabledAt?.toISOString()).toBe(T0.toISOString())

      const walletAfter = await prisma.remoteWallet.findUnique({
        where: { id: walletId }
      })
      expect(walletAfter?.status).toBe('DISABLED')
      expect(walletAfter?.isDefault).toBe(true)

      const addrAfter = await prisma.lightningAddress.findUnique({
        where: { username: primaryUsername }
      })
      expect(addrAfter?.mode).toBe('CUSTOM_NWC')
      expect(addrAfter?.remoteWalletId).toBe(walletId)

      listenerNwcRequest.mockResolvedValue({
        transactions: [disabledWindowPayment]
      })

      const recoveredWhileDisabled = await sweepMissedPayments({ force: true })
      expect(recoveredWhileDisabled).toBe(0)
      const receiptsWhileDisabled =
        await prisma.remoteWalletForwardReceipt.count({
          where: { walletId }
        })
      expect(receiptsWhileDisabled).toBe(0)

      const res2 = await patchHandler(
        createNextRequest(`/api/remote-wallets/${walletId}`, {
          method: 'PATCH',
          body: { status: 'ACTIVE' }
        }),
        createParamsPromise({ id: walletId })
      )
      expect(res2.status).toBe(200)

      const actionAfterReactivated =
        await prisma.remoteWalletReceiveAction.findUnique({
          where: { remoteWalletId: walletId }
        })
      expect(actionAfterReactivated?.enabled).toBe(false)
      expect(actionAfterReactivated?.enabledAt?.toISOString()).toBe(
        T0.toISOString()
      )

      const reenable = await setReceiveActionEnabled(walletId, userId, true)
      expect(reenable.enabled).toBe(true)
      const actionAfterEnable =
        await prisma.remoteWalletReceiveAction.findUnique({
          where: { remoteWalletId: walletId }
        })
      expect(actionAfterEnable?.enabled).toBe(true)
      expect(actionAfterEnable?.enabledAt?.getTime()).toBeGreaterThan(
        T0.getTime()
      )
      expect(actionAfterEnable?.enabledAt?.getTime()).toBeGreaterThan(
        Date.now() - 10_000
      )

      const recoveredAfterReenable = await sweepMissedPayments({ force: true })
      expect(recoveredAfterReenable).toBe(0)
      const receiptsAfterReenable =
        await prisma.remoteWalletForwardReceipt.count({
          where: { walletId }
        })
      expect(receiptsAfterReenable).toBe(0)
    })
  }
)
