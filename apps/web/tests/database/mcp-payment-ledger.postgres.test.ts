import { createHash, randomBytes, randomUUID } from 'node:crypto'
import b11 from 'bolt11'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import type { Prisma, PrismaClient } from '@/lib/generated/prisma'
import { createPrismaClient } from '@/lib/create-prisma-client'
import { Role } from '@/lib/auth/permissions'
import type { McpCaller, McpToolError, NativeTool } from '@/lib/mcp/types'
import type { PayInvoiceInput } from '@/lib/wallet/drivers'

const databaseUrl = process.env.CARD_PAYMENT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

// Only the wallet is fake: the driver (payInvoice, reconciliation lookups) and
// the NWC send probe would reach a relay. The ledger, the grant row lock, the
// unique key and every conditional update run against the real Postgres.
const mocks = vi.hoisted(() => ({
  payInvoice: vi.fn(),
  canSend: vi.fn(),
  reconcile: vi.fn(),
  activity: vi.fn(),
  /** What driverForWallet hands back: the decrypted wallet config. */
  config: {
    connectionString: 'nostr+walletconnect://wallet?secret=test',
    mode: 'SEND_RECEIVE'
  }
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ logLevel: 'silent', maintenance: { enabled: false } })
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@/lib/wallet/drivers', async () => ({
  ...(await import('@/lib/wallet/drivers/errors')),
  driverForWallet: () => ({
    driver: { payInvoice: mocks.payInvoice },
    config: mocks.config
  }),
  reconcileDirectNwcPayment: mocks.reconcile
}))
vi.mock('@/lib/wallet/nwc-send-capability', () => ({
  nwcWalletCanSend: mocks.canSend
}))
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    MCP_PAYMENT_SENT: 'nwc.mcp_payment_sent',
    MCP_PAYMENT_FAILED: 'nwc.mcp_payment_failed'
  },
  logActivity: { fireAndForget: mocks.activity }
}))

type Result = Record<string, any>

const DAY_MS = 24 * 60 * 60 * 1000

/** Preimage of every invoice minted here, keyed by its BOLT11. */
const preimages = new Map<string, string>()

/** A real signed BOLT11 invoice, so the verifying decoder runs. */
function invoice(sats: number) {
  const preimage = randomBytes(32)
  const paymentHash = createHash('sha256').update(preimage).digest('hex')
  const { paymentRequest } = b11.sign(
    b11.encode({
      satoshis: sats,
      timestamp: Math.floor(Date.now() / 1000),
      tags: [
        { tagName: 'payment_hash', data: paymentHash },
        { tagName: 'payment_secret', data: randomBytes(32).toString('hex') },
        { tagName: 'description', data: 'mcp ledger test' },
        { tagName: 'expire_time', data: 3600 }
      ]
    }),
    randomBytes(32)
  )
  const bolt11 = paymentRequest as string
  preimages.set(bolt11, preimage.toString('hex'))
  return { bolt11, paymentHash, preimage: preimage.toString('hex') }
}

/** The wallet pays: it answers with the preimage of the invoice it was handed. */
function pays(feesPaidSats = 0, until: Promise<void> = Promise.resolve()) {
  return async (_config: unknown, input: PayInvoiceInput) => {
    await until
    return { preimage: preimages.get(input.bolt11), feesPaidSats }
  }
}

/** A payment the wallet keeps in flight until released. */
function inFlight() {
  let release!: () => void
  const released = new Promise<void>(resolve => {
    release = resolve
  })
  return { released, release }
}

/**
 * Stands in for the send probe, the last await before the claim: holds each
 * call until `parties` have arrived, so all of them passed the pre-claim
 * ledger check and enter claimPayment together.
 */
function claimTogether(parties: number) {
  let arrived = 0
  const { released, release } = inFlight()
  return async () => {
    if (++arrived === parties) release()
    await released
    return true
  }
}

/** Whichever call answers first; the other may still be paying. */
function firstSettled(calls: Promise<Result>[]) {
  return Promise.race(
    calls.map((call, index) =>
      call.then(
        value => ({ index, value, error: undefined }),
        (error: McpToolError) => ({ index, value: undefined, error })
      )
    )
  )
}

async function refused(call: Promise<unknown>): Promise<McpToolError> {
  const error = await call.then(
    () => {
      throw new Error('expected the call to be refused')
    },
    (err: McpToolError) => err
  )
  expect(error.name).toBe('McpToolError')
  return error
}

describe.skipIf(!runDatabaseTests)(
  'MCP payment ledger against PostgreSQL',
  () => {
    let prisma: PrismaClient
    let walletTools: NativeTool[]
    let PaymentRejectedError: typeof import('@/lib/wallet/drivers').PaymentRejectedError
    const suffix = randomUUID()
    const userId = `mcp-ledger-user-${suffix}`
    const pubkey = randomBytes(32).toString('hex')
    const walletId = `mcp-ledger-wallet-${suffix}`
    const claude = { id: `mcp-ledger-claude-${suffix}`, name: 'Claude' }
    const chatgpt = { id: `mcp-ledger-chatgpt-${suffix}`, name: 'ChatGPT' }

    beforeAll(async () => {
      if (!databaseUrl || !runDatabaseTests) return
      prisma = createPrismaClient(databaseUrl)
      vi.resetModules()
      vi.doMock('@/lib/prisma', () => ({ prisma }))
      ;({ walletTools } = await import('@/lib/mcp/wallet-tools'))
      // After resetModules: the class wallet-tools checks `instanceof` against.
      ;({ PaymentRejectedError } = await import('@/lib/wallet/drivers'))

      await prisma.user.create({ data: { id: userId, pubkey } })
      await prisma.remoteWallet.create({
        data: {
          id: walletId,
          userId,
          name: `MCP ledger ${suffix}`,
          type: 'NWC',
          config: {
            connectionString: 'lwrw1:ciphertext',
            mode: 'SEND_RECEIVE'
          },
          status: 'ACTIVE'
        }
      })
      await prisma.oAuthClient.createMany({
        data: [claude, chatgpt].map(client => ({
          ...client,
          redirectUris: ['https://claude.ai/api/mcp/auth_callback']
        }))
      })
    })

    afterAll(async () => {
      if (!databaseUrl || !runDatabaseTests || !prisma) return
      await prisma.mcpPayment.deleteMany({ where: { userId } })
      await prisma.oAuthGrant.deleteMany({ where: { userId } })
      await prisma.oAuthClient.deleteMany({
        where: { id: { in: [claude.id, chatgpt.id] } }
      })
      await prisma.remoteWallet.deleteMany({ where: { id: walletId } })
      await prisma.user.deleteMany({ where: { id: userId } })
      await prisma.$disconnect()
      vi.doUnmock('@/lib/prisma')
    })

    beforeEach(() => {
      mocks.payInvoice.mockReset()
      mocks.canSend.mockReset().mockResolvedValue(true)
      mocks.reconcile.mockReset().mockResolvedValue(null)
      mocks.activity.mockReset()
    })

    /** A working (exchanged) grant with read, write and spend, and its caller. */
    async function connection(spendLimitSats: number, client = claude) {
      const grant = await prisma.oAuthGrant.create({
        data: {
          clientId: client.id,
          userId,
          scopes: ['read', 'write', 'spend'],
          resource: 'https://wallet.example/api/mcp',
          spendLimitSats,
          codeUsedAt: new Date()
        }
      })
      const caller: McpCaller = {
        user: { pubkey, userId, role: Role.USER },
        scopes: new Set(['read', 'write', 'spend']),
        grant: { id: grant.id, clientName: client.name, spendLimitSats },
        authorization: null,
        apiUrl: 'https://wallet.example',
        request: new Request('https://wallet.example/api/mcp', {
          method: 'POST'
        })
      }
      return { grantId: grant.id, caller }
    }

    const tool = (name: string) => walletTools.find(t => t.name === name)!
    const pay = (caller: McpCaller, bolt11: string) =>
      tool('wallet_pay_invoice').handler(
        { bolt11, walletId },
        caller
      ) as Promise<Result>
    const listPayments = (caller: McpCaller) =>
      tool('wallet_list_payments').handler({}, caller) as Promise<Result>
    const ledger = (where: Prisma.McpPaymentWhereInput) =>
      prisma.mcpPayment.findMany({ where, orderBy: { createdAt: 'asc' } })

    it('records a paid invoice and charges amount plus fees to the budget', async () => {
      const { grantId, caller } = await connection(1000)
      const inv = invoice(100)
      mocks.payInvoice.mockImplementation(pays(2))
      const before = await listPayments(caller)
      expect(before.budget).toEqual({
        limitSats: 1000,
        spentLast24hSats: 0,
        remainingSats: 1000
      })

      const result = await pay(caller, inv.bolt11)

      const rows = await ledger({ grantId })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        userId,
        walletId,
        paymentHash: inv.paymentHash,
        bolt11: inv.bolt11,
        amountSats: 100,
        feesPaidSats: 2,
        status: 'SUCCEEDED',
        preimage: inv.preimage,
        error: null
      })
      expect(rows[0].resolvedAt).toBeInstanceOf(Date)
      expect(mocks.payInvoice).toHaveBeenCalledTimes(1)
      expect(mocks.payInvoice).toHaveBeenCalledWith(
        mocks.config,
        { bolt11: inv.bolt11, amountSats: undefined },
        { walletId, requestId: rows[0].id, paymentHash: inv.paymentHash }
      )
      expect(result).toMatchObject({
        status: 'SUCCEEDED',
        alreadyPaid: false,
        paymentId: rows[0].id,
        preimage: inv.preimage,
        feesPaidSats: 2,
        budget: {
          limitSats: 1000,
          spentLast24hSats: 102,
          remainingSats: before.budget.remainingSats - 100 - 2
        }
      })
    })

    it('pays an invoice sent twice at the same moment exactly once', async () => {
      const { grantId, caller } = await connection(1000)
      const inv = invoice(100)
      const wallet = inFlight()
      mocks.canSend.mockImplementation(claimTogether(2))
      mocks.payInvoice.mockImplementation(pays(0, wallet.released))

      const calls = [pay(caller, inv.bolt11), pay(caller, inv.bolt11)]

      // The loser answers from the ledger while the winner is still paying.
      const loser = await firstSettled(calls)
      expect(loser.error).toBeUndefined()
      expect(loser.value).toMatchObject({
        status: 'PENDING',
        alreadyPaid: false
      })
      expect(loser.value?.message).toMatch(/was NOT sent again/)
      await vi.waitFor(() => expect(mocks.payInvoice).toHaveBeenCalledTimes(1))
      expect(await ledger({ paymentHash: inv.paymentHash })).toMatchObject([
        { grantId, status: 'PENDING' }
      ])

      wallet.release()
      await expect(calls[1 - loser.index]).resolves.toMatchObject({
        status: 'SUCCEEDED',
        alreadyPaid: false,
        preimage: inv.preimage
      })

      expect(mocks.payInvoice).toHaveBeenCalledTimes(1)
      const rows = await ledger({ paymentHash: inv.paymentHash })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ grantId, status: 'SUCCEEDED' })
      expect(mocks.payInvoice.mock.calls[0][2]).toMatchObject({
        requestId: rows[0].id
      })
    })

    it('lets the unique key arbitrate when two connections pay one invoice at the same moment', async () => {
      const first = await connection(1000, claude)
      const second = await connection(1000, chatgpt)
      const inv = invoice(100)
      const wallet = inFlight()
      mocks.canSend.mockImplementation(claimTogether(2))
      mocks.payInvoice.mockImplementation(pays(0, wallet.released))

      // Different grants: no shared row lock, only (walletId, paymentHash).
      const calls = [
        pay(first.caller, inv.bolt11),
        pay(second.caller, inv.bolt11)
      ]

      const loser = await firstSettled(calls)
      expect(loser.error).toBeUndefined()
      expect(loser.value).toMatchObject({
        status: 'PENDING',
        alreadyPaid: false
      })
      await vi.waitFor(() => expect(mocks.payInvoice).toHaveBeenCalledTimes(1))
      wallet.release()
      await expect(calls[1 - loser.index]).resolves.toMatchObject({
        status: 'SUCCEEDED',
        alreadyPaid: false
      })

      expect(mocks.payInvoice).toHaveBeenCalledTimes(1)
      const rows = await ledger({ paymentHash: inv.paymentHash })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        grantId: [first, second][1 - loser.index].grantId,
        status: 'SUCCEEDED'
      })
    })

    it('lets only one of two simultaneous payments into the last of the budget', async () => {
      const { grantId, caller } = await connection(1000)
      // Each fits the budget alone; together they do not.
      const invoices = [invoice(600), invoice(700)]
      const wallet = inFlight()
      mocks.canSend.mockImplementation(claimTogether(2))
      mocks.payInvoice.mockImplementation(pays(0, wallet.released))

      const calls = invoices.map(inv => pay(caller, inv.bolt11))

      // Refused while the winner's payment is still in flight: its PENDING
      // row, committed under the grant lock, already counts.
      const loser = await firstSettled(calls)
      const paid = invoices[1 - loser.index]
      const paidSats = loser.index === 0 ? 700 : 600
      expect(loser.error?.message).toMatch(
        /would exceed this connection's daily budget/
      )
      expect(loser.error?.data).toEqual({
        amountSats: loser.index === 0 ? 600 : 700,
        budget: {
          limitSats: 1000,
          spentLast24hSats: paidSats,
          remainingSats: 1000 - paidSats
        }
      })
      await vi.waitFor(() => expect(mocks.payInvoice).toHaveBeenCalledTimes(1))
      wallet.release()
      await expect(calls[1 - loser.index]).resolves.toMatchObject({
        status: 'SUCCEEDED',
        paymentHash: paid.paymentHash
      })

      expect(mocks.payInvoice).toHaveBeenCalledTimes(1)
      expect(mocks.payInvoice.mock.calls[0][1]).toMatchObject({
        bolt11: paid.bolt11
      })
      expect(await ledger({ grantId })).toMatchObject([
        { paymentHash: paid.paymentHash, status: 'SUCCEEDED' }
      ])
      expect(
        await prisma.mcpPayment.count({
          where: { paymentHash: invoices[loser.index].paymentHash }
        })
      ).toBe(0)
    })

    it('refuses a payment over the budget without recording or sending it', async () => {
      const { grantId, caller } = await connection(1000)
      const inv = invoice(1001)

      const error = await refused(pay(caller, inv.bolt11))

      expect(error.message).toMatch(
        /would exceed this connection's daily budget: 1000 of 1000 sats left/
      )
      expect(error.data).toEqual({
        amountSats: 1001,
        budget: { limitSats: 1000, spentLast24hSats: 0, remainingSats: 1000 }
      })
      expect(mocks.payInvoice).not.toHaveBeenCalled()
      expect(await prisma.mcpPayment.count({ where: { grantId } })).toBe(0)
      expect(
        await prisma.mcpPayment.count({
          where: { paymentHash: inv.paymentHash }
        })
      ).toBe(0)
    })

    it('releases the budget when the wallet rejects, and pays a retry under a new ledger id', async () => {
      const { grantId, caller } = await connection(1000)
      const inv = invoice(300)
      mocks.payInvoice.mockRejectedValueOnce(
        new PaymentRejectedError('no route', { code: 'INSUFFICIENT_BALANCE' })
      )

      const rejection = await refused(pay(caller, inv.bolt11))

      expect(rejection.message).toMatch(
        /rejected the payment \(INSUFFICIENT_BALANCE\)/
      )
      expect(rejection.data).toMatchObject({
        status: 'FAILED',
        budget: { limitSats: 1000, spentLast24hSats: 0, remainingSats: 1000 }
      })
      const [failed, ...others] = await ledger({ grantId })
      expect(others).toEqual([])
      expect(failed).toMatchObject({
        paymentHash: inv.paymentHash,
        status: 'FAILED',
        error: 'INSUFFICIENT_BALANCE'
      })
      expect(failed.resolvedAt).toBeInstanceOf(Date)
      expect(mocks.payInvoice.mock.calls[0][2]).toMatchObject({
        requestId: failed.id
      })

      mocks.payInvoice.mockImplementation(pays(1))
      const retry = await pay(caller, inv.bolt11)

      expect(mocks.payInvoice).toHaveBeenCalledTimes(2)
      const rows = await ledger({ paymentHash: inv.paymentHash })
      expect(rows).toHaveLength(1)
      expect(rows[0].id).not.toBe(failed.id)
      expect(rows[0]).toMatchObject({
        grantId,
        status: 'SUCCEEDED',
        preimage: inv.preimage,
        error: null
      })
      expect(mocks.payInvoice.mock.calls[1][2]).toMatchObject({
        requestId: rows[0].id
      })
      expect(retry).toMatchObject({
        status: 'SUCCEEDED',
        alreadyPaid: false,
        paymentId: rows[0].id,
        budget: { spentLast24hSats: 301, remainingSats: 699 }
      })
    })

    it('keeps an unknown outcome charged and never dispatches it again', async () => {
      const { grantId, caller } = await connection(1000)
      const inv = invoice(250)
      mocks.payInvoice.mockRejectedValue(new Error('relay connection dropped'))

      const first = await pay(caller, inv.bolt11)

      expect(first).toMatchObject({
        status: 'UNKNOWN',
        alreadyPaid: false,
        budget: { spentLast24hSats: 250, remainingSats: 750 }
      })
      expect(first.message).toMatch(/Do NOT retry/)
      const [unknown, ...others] = await ledger({ grantId })
      expect(others).toEqual([])
      expect(unknown).toMatchObject({
        paymentHash: inv.paymentHash,
        status: 'UNKNOWN',
        error: 'OUTCOME_UNKNOWN',
        resolvedAt: null,
        preimage: null
      })

      const again = await pay(caller, inv.bolt11)

      expect(mocks.payInvoice).toHaveBeenCalledTimes(1)
      expect(again).toMatchObject({
        status: 'UNKNOWN',
        alreadyPaid: false,
        paymentId: unknown.id,
        budget: { spentLast24hSats: 250, remainingSats: 750 }
      })
      expect(again.message).toMatch(/was NOT sent again/)
      expect(await ledger({ paymentHash: inv.paymentHash })).toMatchObject([
        { id: unknown.id, status: 'UNKNOWN' }
      ])
    })

    it('refuses a grant revoked after its token was verified, sending nothing', async () => {
      const { grantId, caller } = await connection(1000)
      await prisma.oAuthGrant.update({
        where: { id: grantId },
        data: { revokedAt: new Date() }
      })
      const inv = invoice(100)
      // The caller was resolved before the revocation and still says spend.
      expect(caller.scopes.has('spend')).toBe(true)

      const error = await refused(pay(caller, inv.bolt11))

      expect(error.message).toMatch(
        /revoked or may no longer send payments\. Nothing was sent/
      )
      expect(mocks.payInvoice).not.toHaveBeenCalled()
      expect(await prisma.mcpPayment.count({ where: { grantId } })).toBe(0)
      expect(
        await prisma.mcpPayment.count({
          where: { paymentHash: inv.paymentHash }
        })
      ).toBe(0)
    })

    it("does not pay an invoice again for another connection, nor show it the payer's preimage", async () => {
      const payer = await connection(1000, claude)
      const other = await connection(1000, chatgpt)
      const inv = invoice(100)
      mocks.payInvoice.mockImplementation(pays(1))
      await expect(pay(payer.caller, inv.bolt11)).resolves.toMatchObject({
        status: 'SUCCEEDED',
        preimage: inv.preimage
      })

      const repeat = await pay(other.caller, inv.bolt11)

      expect(mocks.payInvoice).toHaveBeenCalledTimes(1)
      expect(repeat).toMatchObject({
        status: 'SUCCEEDED',
        alreadyPaid: true,
        message: 'This invoice was already paid; it was not paid again.',
        preimage: null,
        budget: { limitSats: 1000, spentLast24hSats: 0, remainingSats: 1000 }
      })
      expect(JSON.stringify(repeat)).not.toContain(inv.preimage)
      expect(await ledger({ paymentHash: inv.paymentHash })).toMatchObject([
        { grantId: payer.grantId, status: 'SUCCEEDED' }
      ])
      const listed = await listPayments(other.caller)
      expect(listed.payments).toEqual([])
    })

    it('lists the ledger with a budget that matches the rows in the database', async () => {
      const { grantId, caller } = await connection(2000)
      const paid = invoice(400)
      const rejected = invoice(300)
      const unknown = invoice(200)
      // Paid just over a day ago: listed, but out of the rolling window.
      const older = invoice(500)
      const dayAgo = new Date(Date.now() - DAY_MS - 60_000)
      await prisma.mcpPayment.create({
        data: {
          grantId,
          userId,
          walletId,
          paymentHash: older.paymentHash,
          bolt11: older.bolt11,
          amountSats: 500,
          feesPaidSats: 5,
          status: 'SUCCEEDED',
          preimage: older.preimage,
          createdAt: dayAgo,
          resolvedAt: dayAgo
        }
      })
      mocks.payInvoice
        .mockImplementationOnce(pays(3))
        .mockRejectedValueOnce(
          new PaymentRejectedError('declined', { code: 'QUOTA_EXCEEDED' })
        )
        .mockRejectedValueOnce(new Error('relay timeout'))
      await pay(caller, paid.bolt11)
      await refused(pay(caller, rejected.bolt11))
      await pay(caller, unknown.bolt11)

      const listed = await listPayments(caller)

      const rows = await ledger({ grantId })
      expect(rows.map(row => row.status).sort()).toEqual([
        'FAILED',
        'SUCCEEDED',
        'SUCCEEDED',
        'UNKNOWN'
      ])
      const byId = (a: Result, b: Result) =>
        a.paymentId.localeCompare(b.paymentId)
      expect([...listed.payments].sort(byId)).toEqual(
        rows
          .map(row => ({
            paymentId: row.id,
            walletId: row.walletId,
            paymentHash: row.paymentHash,
            amountSats: row.amountSats,
            feesPaidSats: row.feesPaidSats,
            status: row.status,
            preimage: row.preimage,
            error: row.error,
            createdAt: row.createdAt.toISOString(),
            resolvedAt: row.resolvedAt?.toISOString() ?? null
          }))
          .sort(byId)
      )
      const times = listed.payments.map((p: Result) => Date.parse(p.createdAt))
      expect(times).toEqual([...times].sort((a, b) => b - a))
      expect(listed.payments.at(-1).paymentHash).toBe(older.paymentHash)

      // Charged: the last 24 h, fees included, FAILED released.
      const since = Date.now() - DAY_MS
      const charged = rows
        .filter(
          row => row.status !== 'FAILED' && row.createdAt.getTime() >= since
        )
        .reduce((sum, row) => sum + row.amountSats + (row.feesPaidSats ?? 0), 0)
      expect(charged).toBe(603)
      expect(listed.budget).toEqual({
        limitSats: 2000,
        spentLast24hSats: charged,
        remainingSats: 2000 - charged
      })
    })
  }
)
