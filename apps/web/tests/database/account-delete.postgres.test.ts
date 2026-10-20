import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/lib/generated/prisma'
import { createPrismaClient } from '@/lib/create-prisma-client'

const databaseUrl = process.env.CARD_PAYMENT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

/**
 * The mocked route tests can only assert `where` clauses. These run
 * `deleteAccount` against real PostgreSQL: the FK cascades, the receipt →
 * revision `Restrict`, SetNull survivors, and the admin row lock.
 */
describe.skipIf(!runDatabaseTests)('deleteAccount against PostgreSQL', () => {
  let prisma: PrismaClient
  let deleteAccount: (userId: string) => Promise<unknown>
  const s = randomUUID().slice(0, 8)
  const pk = (c: string) => `${c}${s}`.padEnd(64, '0')
  const A = `del-a-${s}`
  const B = `del-b-${s}`
  const designId = `del-design-${s}`
  const username = `del${s}`
  const cardA = `del-card-a-${s}`
  const cardB = `del-card-b-${s}`
  const cidA = `a${s}`.padEnd(14, '0')
  const clientId = `del-client-${s}`
  let walletA: string
  let walletB: string

  beforeAll(async () => {
    if (!databaseUrl || !runDatabaseTests) return
    prisma = createPrismaClient(databaseUrl)
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({ prisma }))
    vi.doMock('@/lib/auth/account', () => ({ forgetResolvedAccounts: vi.fn() }))
    vi.doMock('@/lib/activity-log', () => ({
      ActivityEvent: { ACCOUNT_DELETED: 'user.account_deleted' },
      logActivity: { fireAndForget: vi.fn() }
    }))
    ;({ deleteAccount } = await import('@/lib/account/delete'))

    await prisma.cardDesign.create({
      data: { id: designId, imageUrl: 'https://x.test/c.png', description: 'd' }
    })
    await prisma.oAuthClient.create({
      data: { id: clientId, name: 'c', redirectUris: ['https://x.test/cb'] }
    })

    for (const id of [A, B]) {
      const pubkey = pk(id === A ? 'a' : 'b')
      await prisma.user.create({
        data: {
          id,
          pubkey,
          nostrIdentities: { create: { pubkey, isPrimary: true } }
        }
      })
    }

    // ── A owns one of everything ─────────────────────────────────────────
    await prisma.passkeyCredential.create({
      data: {
        id: `del-pk-${s}`,
        userId: A,
        publicKey: Buffer.from('k'),
        deviceType: 'multiDevice',
        rpId: 'x.test'
      }
    })
    await prisma.managedNostrKey.create({
      data: { userId: A, ciphertext: Buffer.from('c') }
    })
    walletA = (
      await prisma.remoteWallet.create({
        data: { userId: A, name: 'a', type: 'LND', config: {} }
      })
    ).id
    await prisma.lightningAddress.create({
      data: { username, userId: A, remoteWalletId: walletA, isPrimary: true }
    })
    const action = await prisma.remoteWalletReceiveAction.create({
      data: { remoteWalletId: walletA }
    })
    const revision = await prisma.remoteWalletReceiveActionRevision.create({
      data: { actionId: action.id, revision: 1 }
    })
    await prisma.remoteWalletForwardReceipt.create({
      data: {
        actionId: action.id,
        revisionId: revision.id,
        walletId: walletA,
        userId: A,
        eventKey: `del-ev-${s}`,
        sourcePaymentHash: `del-hash-${s}`,
        grossAmountMsats: BigInt(1000),
        retainedFeeMsats: BigInt(0),
        targetAmountMsats: BigInt(1000),
        configRevision: 1,
        sourceSettledAt: new Date(),
        legs: {
          create: {
            position: 0,
            destination: 'x@x.test',
            allocationBps: 10000,
            requestedAmountMsats: BigInt(1000)
          }
        }
      }
    })
    await prisma.remoteWalletNotification.create({
      data: {
        remoteWalletId: walletA,
        name: 'n',
        channel: 'WEBHOOK',
        action: 'RECEIVED',
        webhookUrl: 'https://x.test/hook'
      }
    })
    await prisma.ntag424.create({
      data: {
        cid: cidA,
        k0: '0',
        k1: '1',
        k2: '2',
        k3: '3',
        k4: '4',
        ctr: 0,
        userId: A
      }
    })
    await prisma.card.create({
      data: {
        id: cardA,
        designId,
        ntag424Cid: cidA,
        userId: A,
        username,
        remoteWalletId: walletA,
        kind: 'MASTER'
      }
    })
    await prisma.cardActivationToken.create({
      data: { cardId: cardA, qrPayload: 'https://x.test/activate/1' }
    })
    await prisma.cardActivationBonus.create({
      data: { cardId: cardA, userId: A, kind: 'SATS', status: 'REDEEMED' }
    })
    await prisma.invoice.create({
      data: {
        bolt11: 'lnbc1',
        paymentHash: `del-inv-${s}`,
        amountSats: 1,
        description: 'd',
        purpose: 'LUD16_PAYMENT',
        userId: A,
        remoteWalletId: walletA,
        expiresAt: new Date(Date.now() + 60_000)
      }
    })
    await prisma.voucher.create({
      data: {
        userId: A,
        nonce: `del-nonce-${s}`,
        name: 'v',
        merchantPubkey: pk('m'),
        servicePubkey: pk('s'),
        claimUrl: 'https://x.test/claim',
        depositedBy: pk('m')
      }
    })
    const grant = await prisma.oAuthGrant.create({
      data: {
        clientId,
        userId: A,
        scopes: ['read'],
        resource: 'https://x.test'
      }
    })
    await prisma.mcpPayment.create({
      data: {
        grantId: grant.id,
        userId: A,
        walletId: walletA,
        paymentHash: `del-mcp-${s}`,
        bolt11: 'lnbc1',
        amountSats: 1
      }
    })
    await prisma.webAuthnChallenge.create({
      data: {
        challenge: `del-ch-${s}`,
        flow: 'LOGIN',
        userId: A,
        rpId: 'x.test',
        origin: 'https://x.test',
        expiresAt: new Date(Date.now() + 60_000)
      }
    })
    await prisma.proxyInvoiceIntent.create({
      data: {
        username,
        userId: A,
        destination: 'x@x.test',
        feeBps: 0,
        grossAmountMsats: BigInt(1000),
        serviceFeeMsats: BigInt(0),
        destinationAmountMsats: BigInt(1000),
        expiresAt: new Date(Date.now() + 60_000)
      }
    })
    await prisma.activityLog.create({
      data: { category: 'USER', event: 'e', message: 'm', userId: A }
    })

    // ── B is a bystander ─────────────────────────────────────────────────
    walletB = (
      await prisma.remoteWallet.create({
        data: { userId: B, name: 'b', type: 'LND', config: {} }
      })
    ).id
    await prisma.lightningAddress.create({
      data: { username: `${username}b`, userId: B, isPrimary: true }
    })
    await prisma.card.create({
      data: { id: cardB, designId, userId: B, remoteWalletId: walletB }
    })

    await deleteAccount(A)
  })

  afterAll(async () => {
    if (!runDatabaseTests || !prisma) return
    await prisma.card.deleteMany({ where: { designId } })
    await prisma.ntag424.deleteMany({ where: { cid: cidA } })
    await prisma.invoice.deleteMany({ where: { paymentHash: `del-inv-${s}` } })
    await prisma.activityLog.deleteMany({ where: { event: 'e', userId: null } })
    await prisma.user.deleteMany({ where: { id: { contains: s } } })
    await prisma.cardDesign.deleteMany({ where: { id: designId } })
    await prisma.oAuthClient.deleteMany({ where: { id: clientId } })
    await prisma.$disconnect()
  })

  it('deletes every row the account owned', async () => {
    const counts = await Promise.all([
      prisma.user.count({ where: { id: A } }),
      prisma.nostrIdentity.count({ where: { userId: A } }),
      prisma.passkeyCredential.count({ where: { userId: A } }),
      prisma.managedNostrKey.count({ where: { userId: A } }),
      prisma.remoteWallet.count({ where: { userId: A } }),
      prisma.remoteWalletReceiveAction.count({
        where: { remoteWalletId: walletA }
      }),
      prisma.remoteWalletForwardReceipt.count({ where: { userId: A } }),
      prisma.remoteWalletNotification.count({
        where: { remoteWalletId: walletA }
      }),
      prisma.voucher.count({ where: { userId: A } }),
      prisma.oAuthGrant.count({ where: { userId: A } }),
      prisma.mcpPayment.count({ where: { userId: A } }),
      prisma.webAuthnChallenge.count({ where: { userId: A } }),
      prisma.proxyInvoiceIntent.count({ where: { userId: A } })
    ])
    expect(counts.every(c => c === 0)).toBe(true)
  })

  it('releases the username so it can be claimed again', async () => {
    await prisma.lightningAddress.create({ data: { username, userId: B } })
    await prisma.lightningAddress.delete({ where: { username } })
  })

  it('unpairs the card instead of deleting it', async () => {
    const card = await prisma.card.findUnique({ where: { id: cardA } })
    expect(card).toMatchObject({
      userId: null,
      username: null,
      remoteWalletId: null,
      kind: 'SIMPLE',
      ntag424Cid: cidA
    })
    const ntag = await prisma.ntag424.findUnique({ where: { cid: cidA } })
    expect(ntag?.userId).toBeNull()
    const token = await prisma.cardActivationToken.findFirst({
      where: { cardId: cardA }
    })
    expect(token?.status).toBe('REVOKED')
  })

  it('keeps the ledger rows with the user reference cleared', async () => {
    const bonus = await prisma.cardActivationBonus.findUnique({
      where: { cardId_kind: { cardId: cardA, kind: 'SATS' } }
    })
    expect(bonus).toMatchObject({ userId: null, status: 'REDEEMED' })
    const invoice = await prisma.invoice.findUnique({
      where: { paymentHash: `del-inv-${s}` }
    })
    expect(invoice).toMatchObject({ userId: null, remoteWalletId: null })
  })

  it('leaves the other account untouched', async () => {
    expect(await prisma.user.count({ where: { id: B } })).toBe(1)
    expect(await prisma.remoteWallet.count({ where: { userId: B } })).toBe(1)
    expect(await prisma.lightningAddress.count({ where: { userId: B } })).toBe(
      1
    )
    const card = await prisma.card.findUnique({ where: { id: cardB } })
    expect(card).toMatchObject({ userId: B, remoteWalletId: walletB })
  })

  it('refuses the last admin and serializes concurrent admin deletions', async () => {
    const admins = [`del-c-${s}`, `del-d-${s}`]
    for (const id of admins) {
      await prisma.user.create({
        data: { id, pubkey: pk(id.slice(4, 5)), role: 'ADMIN' }
      })
    }
    // This dedicated `_test` database must hold no other admins.
    expect(await prisma.user.count({ where: { role: 'ADMIN' } })).toBe(2)

    const results = await Promise.allSettled(admins.map(deleteAccount))

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected')
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 403
    })
    expect(await prisma.user.count({ where: { role: 'ADMIN' } })).toBe(1)
  })
})
