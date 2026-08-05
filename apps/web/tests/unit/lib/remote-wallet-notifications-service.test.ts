import { nip19 } from 'nostr-tools'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const emit = vi.hoisted(() => vi.fn())
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit } }))

import {
  createRemoteWalletNotification,
  enqueueRemoteWalletNotificationEvent,
  retryRemoteWalletNotificationDelivery
} from '@/lib/remote-wallet-notifications/service'

const wallet = {
  id: 'wallet-1',
  userId: 'user-1',
  name: 'Treasury',
  type: 'NWC',
  config: { mode: 'SEND_RECEIVE' },
  status: 'ACTIVE',
  isDefault: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  diedAt: null,
  nwcConfigEncryptedAt: null
}

beforeEach(() => {
  resetPrismaMock()
  emit.mockReset()
  vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
    wallet as never
  )
})

describe('remote wallet notification configuration', () => {
  it('normalizes an npub p-tag before persisting a Nostr channel', async () => {
    const pubkey = '11'.repeat(32)
    vi.mocked(prismaMock.remoteWalletNotification.findMany).mockResolvedValue(
      []
    )

    await createRemoteWalletNotification('wallet-1', 'user-1', {
      name: 'Private audit',
      channel: 'NOSTR',
      action: 'FORWARDED',
      kind: 4,
      pTag: nip19.npubEncode(pubkey),
      relays: ['wss://relay.example.com'],
      content: '{{payload}}',
      nip44: true
    })

    expect(prismaMock.remoteWalletNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        remoteWalletId: 'wallet-1',
        channel: 'NOSTR',
        nostrRecipient: pubkey,
        nostrKind: 4,
        nip44: true
      })
    })
  })
})

describe('enqueueRemoteWalletNotificationEvent', () => {
  it('journals one idempotent delivery per enabled matching channel', async () => {
    vi.mocked(prismaMock.remoteWalletNotification.findMany).mockResolvedValue([
      { id: 'notification-1' },
      { id: 'notification-2' }
    ] as never)
    vi.mocked(
      prismaMock.remoteWalletNotificationDelivery.findMany
    ).mockResolvedValue([{ id: 'delivery-1' }, { id: 'delivery-2' }] as never)

    await expect(
      enqueueRemoteWalletNotificationEvent({
        walletId: 'wallet-1',
        action: 'RECEIVED',
        eventKey: 'listener:event:1',
        payload: {
          payment: { paymentHash: 'aa'.repeat(32), amountMsats: 1000 }
        }
      })
    ).resolves.toEqual(['delivery-1', 'delivery-2'])

    expect(
      prismaMock.remoteWalletNotificationDelivery.createMany
    ).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          notificationId: 'notification-1',
          eventKey: 'listener:event:1',
          action: 'RECEIVED'
        }),
        expect.objectContaining({
          notificationId: 'notification-2',
          eventKey: 'listener:event:1',
          action: 'RECEIVED'
        })
      ],
      skipDuplicates: true
    })
  })
})

describe('retryRemoteWalletNotificationDelivery', () => {
  it('refuses an ambiguous webhook retry to prevent double delivery', async () => {
    vi.mocked(
      prismaMock.remoteWalletNotificationDelivery.findFirst
    ).mockResolvedValue({
      id: 'delivery-1',
      walletId: 'wallet-1',
      status: 'UNKNOWN',
      leaseExpiresAt: null,
      notification: { channel: 'WEBHOOK', enabled: true },
      attempts: [{ status: 'UNKNOWN' }]
    } as never)

    await expect(
      retryRemoteWalletNotificationDelivery(
        'wallet-1',
        'delivery-1',
        'user-1'
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(
      prismaMock.remoteWalletNotificationDelivery.update
    ).not.toHaveBeenCalled()
  })

  it('allows retrying an unknown Nostr publish because the event id is stable', async () => {
    vi.mocked(
      prismaMock.remoteWalletNotificationDelivery.findFirst
    ).mockResolvedValue({
      id: 'delivery-1',
      walletId: 'wallet-1',
      status: 'UNKNOWN',
      leaseExpiresAt: null,
      notification: { channel: 'NOSTR', enabled: true },
      attempts: [{ status: 'UNKNOWN' }]
    } as never)

    await expect(
      retryRemoteWalletNotificationDelivery(
        'wallet-1',
        'delivery-1',
        'user-1'
      )
    ).resolves.toEqual({ accepted: true })
    expect(
      prismaMock.remoteWalletNotificationDelivery.update
    ).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({ status: 'REJECTED' })
    })
  })
})
