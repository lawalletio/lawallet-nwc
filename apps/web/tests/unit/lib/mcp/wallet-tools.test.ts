import crypto from 'node:crypto'
import b11 from 'bolt11'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpPayment, RemoteWallet } from '@/lib/generated/prisma'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const mocks = vi.hoisted(() => ({
  driverForWallet: vi.fn(),
  reconcile: vi.fn(),
  canSend: vi.fn(),
  fetchMetadata: vi.fn(),
  requestInvoice: vi.fn(),
  activity: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ logLevel: 'silent', maintenance: { enabled: false } })
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
// owned.ts also exports a request-authenticating loader this suite never uses.
vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn(),
  authHasPermission: vi.fn()
}))
vi.mock('@/lib/auth/account', () => ({ resolveAccountId: vi.fn() }))
vi.mock('@/lib/wallet/drivers', async () => ({
  ...(await import('@/lib/wallet/drivers/errors')),
  driverForWallet: mocks.driverForWallet,
  reconcileDirectNwcPayment: mocks.reconcile
}))
vi.mock('@/lib/wallet/nwc-send-capability', () => ({
  nwcWalletCanSend: mocks.canSend
}))
vi.mock('@/lib/proxy/lnurl', () => ({
  fetchDestinationMetadata: mocks.fetchMetadata,
  requestDestinationInvoice: mocks.requestInvoice
}))
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    MCP_PAYMENT_SENT: 'nwc.mcp_payment_sent',
    MCP_PAYMENT_FAILED: 'nwc.mcp_payment_failed'
  },
  logActivity: { fireAndForget: mocks.activity }
}))

import { Role } from '@/lib/auth/permissions'
import { logger } from '@/lib/logger'
import { McpToolError, type McpCaller } from '@/lib/mcp/types'
import {
  feeReserveSats,
  readSpendBudget,
  walletTools
} from '@/lib/mcp/wallet-tools'
import type { OAuthScope } from '@/lib/oauth/constants'
import {
  DriverRemoteError,
  PaymentOutcomeUnknownError,
  PaymentRejectedError
} from '@/lib/wallet/drivers/errors'

const USER_ID = 'user-1'
const GRANT_ID = 'grant-1'
const WALLET_ID = 'wallet-1'
const CONNECTION = 'nostr+walletconnect://wallet?secret=s3cr3t'
const CONFIG = { connectionString: CONNECTION, mode: 'SEND_RECEIVE' }

const driver = {
  getBalance: vi.fn(),
  makeInvoice: vi.fn(),
  lookupInvoice: vi.fn(),
  payInvoice: vi.fn()
}

function makeCaller({
  scopes = ['read', 'write', 'spend'],
  grant = { id: GRANT_ID, clientName: 'Claude', spendLimitSats: 1000 },
  userId = USER_ID
}: {
  scopes?: OAuthScope[]
  grant?: McpCaller['grant']
  userId?: string | null
} = {}): McpCaller {
  return {
    user: { pubkey: 'a'.repeat(64), userId, role: Role.USER },
    scopes: new Set(scopes),
    grant,
    authorization: null,
    apiUrl: 'https://wallet.example',
    request: new Request('https://wallet.example/api/mcp', { method: 'POST' })
  }
}

function walletRow(overrides: Partial<RemoteWallet> = {}): RemoteWallet {
  return {
    id: WALLET_ID,
    userId: USER_ID,
    name: 'Main',
    type: 'NWC',
    config: { connectionString: 'lwrw1:ciphertext', mode: 'SEND_RECEIVE' },
    nwcConfigEncryptedAt: null,
    status: 'ACTIVE',
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    diedAt: null,
    diedReason: null,
    ...overrides
  }
}

function paymentRow(overrides: Partial<McpPayment> = {}): McpPayment {
  return {
    id: 'pay-1',
    grantId: GRANT_ID,
    userId: USER_ID,
    walletId: WALLET_ID,
    paymentHash: 'ab'.repeat(32),
    bolt11: 'lnbc1stored',
    amountSats: 100,
    feesPaidSats: null,
    status: 'PENDING',
    preimage: null,
    error: null,
    createdAt: new Date(),
    resolvedAt: null,
    ...overrides
  }
}

/** A real signed BOLT11 invoice; `sats: null` makes a zero-amount one. */
function invoice({
  sats = 100,
  msats,
  expirySeconds = 3600,
  ageSeconds = 0
}: {
  sats?: number | null
  msats?: string
  expirySeconds?: number
  ageSeconds?: number
} = {}) {
  const preimage = crypto.randomBytes(32)
  const paymentHash = crypto.createHash('sha256').update(preimage).digest('hex')
  const amount =
    msats !== undefined
      ? { millisatoshis: msats }
      : sats === null
        ? {}
        : { satoshis: sats }
  const encoded = b11.encode({
    ...amount,
    timestamp: Math.floor(Date.now() / 1000) - ageSeconds,
    tags: [
      { tagName: 'payment_hash', data: paymentHash },
      {
        tagName: 'payment_secret',
        data: crypto.randomBytes(32).toString('hex')
      },
      { tagName: 'description', data: 'mcp test' },
      { tagName: 'expire_time', data: expirySeconds }
    ]
  })
  const { paymentRequest } = b11.sign(encoded, crypto.randomBytes(32))
  return {
    bolt11: paymentRequest as string,
    paymentHash,
    preimage: preimage.toString('hex')
  }
}

function tool(name: string) {
  const found = walletTools.find(candidate => candidate.name === name)
  if (!found) throw new Error(`missing tool ${name}`)
  return found
}

function call(
  name: string,
  args: Record<string, unknown>,
  caller: McpCaller = makeCaller()
) {
  return tool(name).handler(args, caller) as Promise<Record<string, any>>
}

async function toolError(promise: Promise<unknown>): Promise<McpToolError> {
  const error = await promise.then(
    () => {
      throw new Error('expected an McpToolError')
    },
    (err: unknown) => err
  )
  expect(error).toBeInstanceOf(McpToolError)
  return error as McpToolError
}

/** Ledger state for wallet_pay_invoice: limit 1000 sats unless overridden. */
function ledger({
  prior = null,
  spent = 0,
  fees = 0,
  locked = {}
}: {
  prior?: McpPayment | null
  spent?: number
  fees?: number
  locked?: Record<string, unknown>
} = {}) {
  vi.mocked(prismaMock.mcpPayment.findFirst).mockResolvedValue(prior as never)
  vi.mocked(prismaMock.$queryRaw).mockResolvedValue([{ id: GRANT_ID }] as never)
  vi.mocked(prismaMock.oAuthGrant.findUnique).mockResolvedValue({
    userId: USER_ID,
    scopes: ['read', 'spend'],
    spendLimitSats: 1000,
    revokedAt: null,
    ...locked
  } as never)
  vi.mocked(prismaMock.mcpPayment.aggregate).mockResolvedValue({
    _sum: { amountSats: spent, feesPaidSats: fees }
  } as never)
  vi.mocked(prismaMock.mcpPayment.deleteMany).mockResolvedValue({
    count: 0
  } as never)
  vi.mocked(prismaMock.mcpPayment.create).mockImplementation((({
    data
  }: {
    data: Partial<McpPayment>
  }) => Promise.resolve(paymentRow({ id: 'pay-new', ...data }))) as never)
  vi.mocked(prismaMock.mcpPayment.updateMany).mockResolvedValue({
    count: 1
  } as never)
}

const updates = () =>
  vi.mocked(prismaMock.mcpPayment.updateMany).mock.calls.map(([args]) => args)

beforeEach(() => {
  resetPrismaMock()
  for (const mock of Object.values(mocks)) mock.mockReset()
  for (const mock of Object.values(driver)) mock.mockReset()
  vi.mocked(logger.error).mockClear()
  mocks.driverForWallet.mockReturnValue({ driver, config: CONFIG })
  mocks.canSend.mockResolvedValue(true)
  mocks.reconcile.mockResolvedValue(null)
  vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
    walletRow() as never
  )
  vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
    mode: 'CUSTOM_NWC',
    remoteWalletId: WALLET_ID,
    remoteWallet: walletRow()
  } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('wallet tool descriptors', () => {
  it('declares the contract tools with valid names, short descriptions and strict object schemas', () => {
    expect(walletTools.map(t => t.name)).toEqual([
      'wallet_get_balance',
      'wallet_make_invoice',
      'wallet_lookup_invoice',
      'lightning_address_get_invoice',
      'wallet_pay_invoice',
      'wallet_list_payments'
    ])
    for (const t of walletTools) {
      expect(t.name).toMatch(/^[a-z0-9_]{1,64}$/)
      expect(t.title.length).toBeGreaterThan(0)
      expect(t.description.length).toBeLessThanOrEqual(1000)
      if (t.name !== 'wallet_lookup_invoice')
        expect(t.description).toMatch(/sats/)
      expect(t.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false
      })
    }
  })

  it('sets scopes and behaviour hints truthfully', () => {
    expect(
      Object.fromEntries(
        walletTools.map(t => [
          t.name,
          [
            t.scope,
            t.annotations.readOnlyHint,
            t.annotations.destructiveHint,
            t.annotations.openWorldHint
          ]
        ])
      )
    ).toEqual({
      wallet_get_balance: ['read', true, false, true],
      wallet_make_invoice: ['write', false, false, true],
      wallet_lookup_invoice: ['read', true, false, true],
      lightning_address_get_invoice: ['read', true, false, true],
      wallet_pay_invoice: ['spend', false, true, true],
      wallet_list_payments: ['read', true, false, true]
    })
  })

  it('tells the model that paying is irrevocable, needs an explicit request and is budgeted', () => {
    const { description } = tool('wallet_pay_invoice')
    expect(description).toMatch(/real bitcoin irrevocably/)
    expect(description).toMatch(/explicitly asked/)
    expect(description).toMatch(/daily budget/)
    expect(description).toMatch(/do not retry/)
  })

  it('rejects arguments outside the schema with an actionable message', async () => {
    const error = await toolError(
      call('wallet_make_invoice', { amountSats: 1.5, extra: true })
    )
    expect(error.message).toMatch(/^Invalid arguments/)
    expect(error.message).toMatch(/amountSats/)
    expect(error.message).toMatch(/extra/)
    for (const amountSats of [0, -5, 100_000_001]) {
      await toolError(call('wallet_make_invoice', { amountSats }))
    }
    expect(driver.makeInvoice).not.toHaveBeenCalled()
  })

  it('treats missing arguments as an empty object', async () => {
    const error = await toolError(
      tool('wallet_get_balance').handler(
        undefined as never,
        makeCaller({ userId: null })
      )
    )
    expect(error.message).toMatch(/no LaWallet account/)
  })
})

describe('wallet resolution', () => {
  it('uses the wallet named by walletId when the caller owns it', async () => {
    driver.getBalance.mockResolvedValue({ balanceSats: 21 })

    await expect(
      call('wallet_get_balance', { walletId: WALLET_ID })
    ).resolves.toEqual({
      walletId: WALLET_ID,
      walletName: 'Main',
      balanceSats: 21
    })
    expect(prismaMock.remoteWallet.findUnique).toHaveBeenCalledWith({
      where: { id: WALLET_ID }
    })
    expect(mocks.driverForWallet).toHaveBeenCalledWith(
      expect.objectContaining({ id: WALLET_ID, type: 'NWC' })
    )
    expect(driver.getBalance).toHaveBeenCalledWith(CONFIG)
  })

  it("reports another account's wallet exactly like a missing one", async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValueOnce(
      walletRow({ userId: 'someone-else' }) as never
    )
    const foreign = await toolError(
      call('wallet_get_balance', { walletId: 'wallet-x' })
    )
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValueOnce(
      null as never
    )
    const missing = await toolError(
      call('wallet_get_balance', { walletId: 'wallet-x' })
    )

    expect(foreign.message).toBe(missing.message)
    expect(foreign.message).toMatch(/not found.*list_wallets/)
    expect(mocks.driverForWallet).not.toHaveBeenCalled()
  })

  it('falls back to the primary wallet of the account', async () => {
    driver.getBalance.mockResolvedValue({ balanceSats: 5 })

    await expect(call('wallet_get_balance', {})).resolves.toMatchObject({
      walletId: WALLET_ID,
      balanceSats: 5
    })
    expect(prismaMock.lightningAddress.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, isPrimary: true } })
    )
  })

  it('asks for list_wallets when the account has no primary wallet', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(
      null as never
    )
    const error = await toolError(call('wallet_get_balance', {}))
    expect(error.message).toMatch(/no primary wallet.*list_wallets/)
  })

  it('refuses a primary wallet row that belongs to another account', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
      mode: 'CUSTOM_NWC',
      remoteWalletId: WALLET_ID,
      remoteWallet: walletRow({ userId: 'someone-else' })
    } as never)
    await toolError(call('wallet_get_balance', {}))
    expect(mocks.driverForWallet).not.toHaveBeenCalled()
  })

  it('refuses wallets that are not ACTIVE', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      walletRow({ status: 'DISABLED' }) as never
    )
    const error = await toolError(
      call('wallet_get_balance', { walletId: WALLET_ID })
    )
    expect(error.message).toMatch(/is disabled and cannot be used/)
    expect(mocks.driverForWallet).not.toHaveBeenCalled()
  })

  it('refuses callers without an account', async () => {
    const error = await toolError(
      call('wallet_get_balance', {}, makeCaller({ userId: null }))
    )
    expect(error.message).toMatch(/no LaWallet account/)
  })

  it('lets unexpected database errors surface', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockRejectedValue(
      new Error('db down')
    )
    await expect(
      call('wallet_get_balance', { walletId: WALLET_ID })
    ).rejects.toThrow('db down')
  })

  it('reports a misconfigured wallet without its configuration', async () => {
    mocks.driverForWallet.mockImplementation(() => {
      throw new DriverRemoteError('bad config')
    })
    const error = await toolError(call('wallet_get_balance', {}))
    expect(error.message).toMatch(/misconfigured/)
    expect(error.message).not.toContain('walletconnect')
  })
})

describe('wallet_get_balance', () => {
  it('turns a wallet failure into a message the model can act on', async () => {
    driver.getBalance.mockRejectedValue(new DriverRemoteError('relay down'))
    const error = await toolError(call('wallet_get_balance', {}))
    expect(error.message).toMatch(/Could not read the balance of wallet "Main"/)
  })

  it('stops waiting for a wallet that never answers', async () => {
    vi.useFakeTimers()
    driver.getBalance.mockReturnValue(new Promise(() => {}))
    const pending = toolError(call('wallet_get_balance', {}))
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await pending).message).toMatch(/unreachable/)
  })

  it('does not disguise programming errors as wallet failures', async () => {
    driver.getBalance.mockRejectedValue(new TypeError('boom'))
    await expect(call('wallet_get_balance', {})).rejects.toThrow(TypeError)
  })
})

describe('wallet_make_invoice', () => {
  it('mints an invoice in the wallet and never returns the connection', async () => {
    driver.makeInvoice.mockResolvedValue({
      bolt11: 'lnbc210n1minted',
      paymentHash: 'cd'.repeat(32),
      amountSats: 21,
      description: 'coffee',
      expiresAt: Date.UTC(2030, 0, 1)
    })

    const result = await call('wallet_make_invoice', {
      amountSats: 21,
      description: ' coffee '
    })

    expect(driver.makeInvoice).toHaveBeenCalledWith(CONFIG, {
      amountSats: 21,
      description: 'coffee'
    })
    expect(result).toEqual({
      walletId: WALLET_ID,
      bolt11: 'lnbc210n1minted',
      paymentHash: 'cd'.repeat(32),
      amountSats: 21,
      expiresAt: '2030-01-01T00:00:00.000Z'
    })
    expect(JSON.stringify(result)).not.toContain('walletconnect')
  })

  it('reports a missing expiry as null', async () => {
    driver.makeInvoice.mockResolvedValue({
      bolt11: 'lnbc1',
      paymentHash: 'cd'.repeat(32),
      amountSats: 1,
      description: '',
      expiresAt: null
    })
    await expect(
      call('wallet_make_invoice', { amountSats: 1 })
    ).resolves.toMatchObject({ expiresAt: null })
  })

  it('explains a wallet that cannot receive', async () => {
    driver.makeInvoice.mockRejectedValue(new DriverRemoteError('restricted'))
    const error = await toolError(
      call('wallet_make_invoice', { amountSats: 1 })
    )
    expect(error.message).toMatch(/could not create the invoice/)
  })
})

describe('wallet_lookup_invoice', () => {
  it('normalises the hash and reports settlement', async () => {
    driver.lookupInvoice.mockResolvedValue({
      settled: true,
      preimage: 'ef'.repeat(32),
      settledAt: Date.UTC(2030, 0, 2)
    })

    const result = await call('wallet_lookup_invoice', {
      paymentHash: 'AB'.repeat(32)
    })

    expect(driver.lookupInvoice).toHaveBeenCalledWith(CONFIG, {
      paymentHash: 'ab'.repeat(32)
    })
    expect(result).toEqual({
      walletId: WALLET_ID,
      paymentHash: 'ab'.repeat(32),
      settled: true,
      preimage: 'ef'.repeat(32),
      settledAt: '2030-01-02T00:00:00.000Z'
    })
  })

  it('reports an unsettled invoice', async () => {
    driver.lookupInvoice.mockResolvedValue({
      settled: false,
      preimage: null,
      settledAt: null
    })
    await expect(
      call('wallet_lookup_invoice', { paymentHash: 'ab'.repeat(32) })
    ).resolves.toMatchObject({
      settled: false,
      preimage: null,
      settledAt: null
    })
  })

  it('refuses wallets whose driver cannot look invoices up', async () => {
    const { lookupInvoice: _omitted, ...withoutLookup } = driver
    mocks.driverForWallet.mockReturnValue({
      driver: withoutLookup,
      config: CONFIG
    })
    const error = await toolError(
      call('wallet_lookup_invoice', { paymentHash: 'ab'.repeat(32) })
    )
    expect(error.message).toMatch(/does not support invoice lookups/)
  })

  it('explains a failed lookup', async () => {
    driver.lookupInvoice.mockRejectedValue(new DriverRemoteError('not found'))
    const error = await toolError(
      call('wallet_lookup_invoice', { paymentHash: 'ab'.repeat(32) })
    )
    expect(error.message).toMatch(/could not look up this payment hash/)
  })

  it('rejects a malformed payment hash before touching the wallet', async () => {
    await toolError(call('wallet_lookup_invoice', { paymentHash: 'xyz' }))
    expect(mocks.driverForWallet).not.toHaveBeenCalled()
  })
})

describe('lightning_address_get_invoice', () => {
  const metadata = {
    tag: 'payRequest',
    callback: 'https://pay.example/cb',
    minSendable: 1_000,
    maxSendable: 5_000_000,
    metadata: '[]',
    commentAllowed: 100
  }

  it('fetches an invoice through the SSRF-guarded LNURL helpers', async () => {
    mocks.fetchMetadata.mockResolvedValue(metadata)
    mocks.requestInvoice.mockResolvedValue({
      bolt11: 'lnbc5u1remote',
      paymentHash: 'aa'.repeat(32),
      amountMsats: 500_000,
      expiresAt: new Date(Date.UTC(2030, 0, 3))
    })

    const result = await call('lightning_address_get_invoice', {
      address: 'alice@pay.example',
      amountSats: 500,
      comment: 'thanks'
    })

    expect(mocks.fetchMetadata).toHaveBeenCalledWith('alice@pay.example')
    expect(mocks.requestInvoice).toHaveBeenCalledWith({
      metadata,
      amountMsats: 500_000,
      comment: 'thanks'
    })
    expect(result).toEqual({
      address: 'alice@pay.example',
      bolt11: 'lnbc5u1remote',
      paymentHash: 'aa'.repeat(32),
      amountSats: 500,
      expiresAt: '2030-01-03T00:00:00.000Z'
    })
    expect(driver.payInvoice).not.toHaveBeenCalled()
  })

  it('rejects an invalid address without any network request', async () => {
    const error = await toolError(
      call('lightning_address_get_invoice', {
        address: 'not an address',
        amountSats: 1
      })
    )
    expect(error.message).toMatch(/not a valid Lightning Address/)
    expect(mocks.fetchMetadata).not.toHaveBeenCalled()
  })

  it.each([
    [1, 'below'],
    [5_001, 'above']
  ])(
    'refuses %s sats (%s the range) before requesting an invoice',
    async amountSats => {
      mocks.fetchMetadata.mockResolvedValue({ ...metadata, minSendable: 1_500 })
      const error = await toolError(
        call('lightning_address_get_invoice', {
          address: 'alice@pay.example',
          amountSats
        })
      )
      expect(error.message).toBe(
        'alice@pay.example accepts between 2 and 5000 sats.'
      )
      expect(mocks.requestInvoice).not.toHaveBeenCalled()
    }
  )

  it('passes the destination failure on, trimmed', async () => {
    mocks.fetchMetadata.mockRejectedValue(
      new Error('Destination LNURL returned HTTP 404')
    )
    const error = await toolError(
      call('lightning_address_get_invoice', {
        address: 'ghost@pay.example',
        amountSats: 10
      })
    )
    expect(error.message).toBe(
      'Could not get an invoice from ghost@pay.example: Destination LNURL returned HTTP 404'
    )
  })

  it('reports an invoice request failure', async () => {
    mocks.fetchMetadata.mockResolvedValue(metadata)
    mocks.requestInvoice.mockRejectedValue(
      new Error('Destination callback rejected payment')
    )
    const error = await toolError(
      call('lightning_address_get_invoice', {
        address: 'alice@pay.example',
        amountSats: 10
      })
    )
    expect(error.message).toMatch(/Destination callback rejected payment/)
  })
})

describe('readSpendBudget', () => {
  it('counts unresolved and settled payments plus fees in a rolling 24h window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-02T00:00:00Z'))
    vi.mocked(prismaMock.mcpPayment.aggregate).mockResolvedValue({
      _sum: { amountSats: 600, feesPaidSats: 5 }
    } as never)

    await expect(readSpendBudget(GRANT_ID, 1000)).resolves.toEqual({
      limitSats: 1000,
      spentLast24hSats: 605,
      remainingSats: 395
    })
    expect(prismaMock.mcpPayment.aggregate).toHaveBeenCalledWith({
      where: {
        grantId: GRANT_ID,
        status: { not: 'FAILED' },
        createdAt: { gte: new Date('2030-01-01T00:00:00Z') }
      },
      _sum: { amountSats: true, feesPaidSats: true }
    })
  })

  it('never reports a negative remainder, and treats an empty ledger as zero', async () => {
    vi.mocked(prismaMock.mcpPayment.aggregate).mockResolvedValueOnce({
      _sum: { amountSats: 1000, feesPaidSats: 3 }
    } as never)
    await expect(readSpendBudget(GRANT_ID, 1000)).resolves.toMatchObject({
      remainingSats: 0
    })
    vi.mocked(prismaMock.mcpPayment.aggregate).mockResolvedValueOnce({
      _sum: { amountSats: null, feesPaidSats: null }
    } as never)
    await expect(readSpendBudget(GRANT_ID, 1000)).resolves.toMatchObject({
      spentLast24hSats: 0,
      remainingSats: 1000
    })
  })
})

describe('wallet_pay_invoice preconditions', () => {
  it.each([
    [
      'a caller without an OAuth grant',
      makeCaller({ grant: null }),
      /session tokens can never spend/
    ],
    [
      'a grant without the spend scope',
      makeCaller({ scopes: ['read', 'write'] }),
      /lacks the spend scope/
    ],
    [
      'a grant without a spend limit',
      makeCaller({
        grant: { id: GRANT_ID, clientName: 'Claude', spendLimitSats: null }
      }),
      /no daily spend limit/
    ],
    [
      'a caller without an account',
      makeCaller({ userId: null }),
      /no LaWallet account/
    ]
  ])(
    'refuses %s without touching the ledger or the wallet',
    async (_, caller, message) => {
      const error = await toolError(
        call('wallet_pay_invoice', { bolt11: invoice().bolt11 }, caller)
      )
      expect(error.message).toMatch(message)
      expect(prismaMock.mcpPayment.findFirst).not.toHaveBeenCalled()
      expect(driver.payInvoice).not.toHaveBeenCalled()
    }
  )

  it('refuses an undecodable invoice', async () => {
    const error = await toolError(
      call('wallet_pay_invoice', { bolt11: 'lnbc-not-an-invoice' })
    )
    expect(error.message).toMatch(/Invalid invoice/)
    expect(driver.payInvoice).not.toHaveBeenCalled()
  })

  it('refuses an invoice the verifying decoder rejects', async () => {
    // Decodable by the light decoder, but its amount is not a safe integer.
    const error = await toolError(
      call('wallet_pay_invoice', {
        bolt11: invoice({ msats: '9007199254740993' }).bolt11
      })
    )
    expect(error.message).toMatch(/Invalid invoice: .*amount/)
  })

  it('requires amountSats for a zero-amount invoice', async () => {
    const error = await toolError(
      call('wallet_pay_invoice', { bolt11: invoice({ sats: null }).bolt11 })
    )
    expect(error.message).toMatch(/does not specify an amount: pass amountSats/)
  })

  it('refuses an amountSats that contradicts the invoice', async () => {
    const error = await toolError(
      call('wallet_pay_invoice', {
        bolt11: invoice({ sats: 100 }).bolt11,
        amountSats: 150
      })
    )
    expect(error.message).toMatch(/is for 100 sats but amountSats is 150/)
  })

  it('refuses an expired invoice before claiming anything', async () => {
    ledger()
    const error = await toolError(
      call('wallet_pay_invoice', {
        bolt11: invoice({ expirySeconds: 60, ageSeconds: 120 }).bolt11
      })
    )
    expect(error.message).toMatch(/expired/)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.mcpPayment.create).not.toHaveBeenCalled()
    expect(driver.payInvoice).not.toHaveBeenCalled()
  })

  it('refuses a wallet that cannot send', async () => {
    ledger()
    mocks.canSend.mockResolvedValue(false)
    const error = await toolError(
      call('wallet_pay_invoice', { bolt11: invoice().bolt11 })
    )
    expect(error.message).toMatch(/cannot send payments/)
    expect(mocks.canSend).toHaveBeenCalledWith({
      walletId: WALLET_ID,
      config: CONFIG
    })
    expect(prismaMock.mcpPayment.create).not.toHaveBeenCalled()
    expect(driver.payInvoice).not.toHaveBeenCalled()
  })
})

describe('wallet_pay_invoice', () => {
  it('claims, pays once and records the verified result', async () => {
    ledger({ spent: 200, fees: 2 })
    const inv = invoice({ sats: 100 })
    driver.payInvoice.mockResolvedValue({
      preimage: inv.preimage.toUpperCase(),
      feesPaidSats: 1
    })

    const result = await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

    expect(driver.payInvoice).toHaveBeenCalledTimes(1)
    expect(driver.payInvoice).toHaveBeenCalledWith(
      CONFIG,
      { bolt11: inv.bolt11, amountSats: undefined },
      {
        walletId: WALLET_ID,
        requestId: 'pay-new',
        paymentHash: inv.paymentHash
      }
    )
    // The claim happens before the payment, under the grant row lock, and the
    // grant is re-read only once the lock is held.
    const [sql, ...values] = vi.mocked(prismaMock.$queryRaw).mock.calls[0]
    expect((sql as unknown as string[]).join('?')).toMatch(
      /FROM "OAuthGrant" WHERE "id" = \? FOR UPDATE/
    )
    expect(values).toEqual([GRANT_ID])
    expect(
      vi.mocked(prismaMock.$queryRaw).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(prismaMock.oAuthGrant.findUnique).mock.invocationCallOrder[0]
    )
    expect(prismaMock.mcpPayment.create).toHaveBeenCalledWith({
      data: {
        grantId: GRANT_ID,
        userId: USER_ID,
        walletId: WALLET_ID,
        paymentHash: inv.paymentHash,
        bolt11: inv.bolt11,
        amountSats: 100
      }
    })
    expect(
      vi.mocked(prismaMock.mcpPayment.create).mock.invocationCallOrder[0]
    ).toBeLessThan(driver.payInvoice.mock.invocationCallOrder[0])
    expect(updates()).toEqual([
      {
        where: { id: 'pay-new', status: { in: ['PENDING', 'UNKNOWN'] } },
        data: {
          status: 'SUCCEEDED',
          preimage: inv.preimage,
          feesPaidSats: 1,
          error: null,
          resolvedAt: expect.any(Date)
        }
      }
    ])
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      alreadyPaid: false,
      message: 'Payment sent.',
      paymentId: 'pay-new',
      walletId: WALLET_ID,
      paymentHash: inv.paymentHash,
      amountSats: 100,
      feesPaidSats: 1,
      preimage: inv.preimage,
      budget: { limitSats: 1000, spentLast24hSats: 202, remainingSats: 798 }
    })
    expect(JSON.stringify(result)).not.toContain('walletconnect')
    expect(mocks.activity).toHaveBeenCalledTimes(1)
    expect(mocks.activity).toHaveBeenCalledWith({
      category: 'NWC',
      event: 'nwc.mcp_payment_sent',
      level: 'INFO',
      userId: USER_ID,
      message: 'MCP payment of 100 sats sent',
      metadata: expect.objectContaining({
        paymentId: 'pay-new',
        grantId: GRANT_ID,
        clientName: 'Claude',
        walletId: WALLET_ID,
        paymentHash: inv.paymentHash,
        amountSats: 100,
        status: 'SUCCEEDED'
      })
    })
    expect(JSON.stringify(mocks.activity.mock.calls)).not.toContain(inv.bolt11)
  })

  it('accepts a lightning: URI in upper case and pays the normalised invoice', async () => {
    ledger()
    const inv = invoice()
    driver.payInvoice.mockResolvedValue({
      preimage: inv.preimage,
      feesPaidSats: 0
    })

    await call('wallet_pay_invoice', {
      bolt11: `LIGHTNING:${inv.bolt11.toUpperCase()}`
    })

    expect(driver.payInvoice.mock.calls[0][1]).toEqual({
      bolt11: inv.bolt11,
      amountSats: undefined
    })
  })

  it('pays a zero-amount invoice with amountSats and charges that to the budget', async () => {
    ledger()
    const inv = invoice({ sats: null })
    driver.payInvoice.mockResolvedValue({
      preimage: inv.preimage,
      feesPaidSats: 0
    })

    await call('wallet_pay_invoice', { bolt11: inv.bolt11, amountSats: 250 })

    expect(driver.payInvoice.mock.calls[0][1]).toEqual({
      bolt11: inv.bolt11,
      amountSats: 250
    })
    expect(prismaMock.mcpPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountSats: 250,
        paymentHash: inv.paymentHash
      })
    })
  })

  it('accepts a matching amountSats on a fixed invoice but never forwards it', async () => {
    ledger()
    const inv = invoice({ sats: 100 })
    driver.payInvoice.mockResolvedValue({
      preimage: inv.preimage,
      feesPaidSats: 0
    })

    await call('wallet_pay_invoice', { bolt11: inv.bolt11, amountSats: 100 })

    expect(driver.payInvoice.mock.calls[0][1]).toEqual({
      bolt11: inv.bolt11,
      amountSats: undefined
    })
  })

  it('rounds a sub-sat invoice up for the budget', async () => {
    ledger()
    const inv = invoice({ msats: '1500' })
    driver.payInvoice.mockResolvedValue({
      preimage: inv.preimage,
      feesPaidSats: 0
    })

    await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

    expect(prismaMock.mcpPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amountSats: 2 })
    })
  })

  it('skips the NWC send probe for other wallet types', async () => {
    ledger()
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
      mode: 'CUSTOM_NWC',
      remoteWalletId: WALLET_ID,
      remoteWallet: walletRow({ type: 'LND' })
    } as never)
    const inv = invoice()
    driver.payInvoice.mockResolvedValue({
      preimage: inv.preimage,
      feesPaidSats: 0
    })

    await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

    expect(mocks.canSend).not.toHaveBeenCalled()
    expect(driver.payInvoice).toHaveBeenCalledTimes(1)
  })

  describe('budget', () => {
    it('allows a payment that exactly reaches the limit with its fee reserve', async () => {
      ledger({ spent: 850, fees: 50 })
      const inv = invoice({ sats: 90 })
      driver.payInvoice.mockResolvedValue({
        preimage: inv.preimage,
        feesPaidSats: 0
      })

      await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

      expect(driver.payInvoice).toHaveBeenCalledTimes(1)
    })

    it('refuses a payment that would exceed it, without claiming or paying', async () => {
      ledger({ spent: 850, fees: 50 })

      const error = await toolError(
        call('wallet_pay_invoice', { bolt11: invoice({ sats: 91 }).bolt11 })
      )

      expect(error.message).toMatch(
        /plus up to 10 sats reserved for routing fees\) would exceed this connection's daily budget: 100 of 1000 sats left/
      )
      expect(error.data).toEqual({
        amountSats: 91,
        budget: { limitSats: 1000, spentLast24hSats: 900, remainingSats: 100 }
      })
      expect(prismaMock.mcpPayment.create).not.toHaveBeenCalled()
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })

    it('enforces the limit stored on the locked grant row, not the caller snapshot', async () => {
      ledger({ spent: 0, locked: { spendLimitSats: 50 } })

      const error = await toolError(
        call('wallet_pay_invoice', { bolt11: invoice({ sats: 100 }).bolt11 })
      )

      expect(error.data?.budget).toMatchObject({ limitSats: 50 })
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })

    it('does not count FAILED payments and reads the budget inside the claim transaction', async () => {
      ledger()
      const inv = invoice()
      driver.payInvoice.mockResolvedValue({
        preimage: inv.preimage,
        feesPaidSats: 0
      })

      await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

      const [claimRead] = vi.mocked(prismaMock.mcpPayment.aggregate).mock.calls
      expect(claimRead[0]).toMatchObject({
        where: { grantId: GRANT_ID, status: { not: 'FAILED' } }
      })
      expect(
        vi.mocked(prismaMock.mcpPayment.aggregate).mock.invocationCallOrder[0]
      ).toBeLessThan(
        vi.mocked(prismaMock.mcpPayment.create).mock.invocationCallOrder[0]
      )
    })
  })

  describe('grant re-checked under the lock', () => {
    it.each([
      ['revoked', { revokedAt: new Date() }],
      ['stripped of spend', { scopes: ['read'] }],
      ['moved to another account', { userId: 'someone-else' }],
      ['left without a limit', { spendLimitSats: null }]
    ])('refuses when the grant was %s meanwhile', async (_, locked) => {
      ledger({ locked })

      const error = await toolError(
        call('wallet_pay_invoice', { bolt11: invoice().bolt11 })
      )

      expect(error.message).toMatch(
        /revoked or may no longer send payments. Nothing was sent/
      )
      expect(prismaMock.mcpPayment.create).not.toHaveBeenCalled()
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })

    it('refuses when the grant row is gone', async () => {
      ledger()
      vi.mocked(prismaMock.oAuthGrant.findUnique).mockResolvedValue(
        null as never
      )
      await toolError(call('wallet_pay_invoice', { bolt11: invoice().bolt11 }))
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })
  })

  describe('never pays twice', () => {
    it('returns the stored result of a paid invoice without calling the wallet', async () => {
      const inv = invoice({ expirySeconds: 60, ageSeconds: 3600 })
      ledger({
        prior: paymentRow({
          paymentHash: inv.paymentHash,
          status: 'SUCCEEDED',
          preimage: inv.preimage,
          feesPaidSats: 1,
          resolvedAt: new Date()
        })
      })

      const result = await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

      expect(result).toMatchObject({
        status: 'SUCCEEDED',
        alreadyPaid: true,
        paymentId: 'pay-1',
        preimage: inv.preimage,
        budget: expect.any(Object)
      })
      expect(prismaMock.mcpPayment.findFirst).toHaveBeenCalledWith({
        where: {
          paymentHash: inv.paymentHash,
          status: { not: 'FAILED' },
          OR: [{ walletId: WALLET_ID }, { userId: USER_ID }]
        }
      })
      expect(driver.payInvoice).not.toHaveBeenCalled()
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
      expect(mocks.canSend).not.toHaveBeenCalled()
      expect(mocks.reconcile).not.toHaveBeenCalled()
    })

    it("withholds another connection's preimage", async () => {
      const inv = invoice()
      ledger({
        prior: paymentRow({
          grantId: 'grant-other',
          paymentHash: inv.paymentHash,
          status: 'SUCCEEDED',
          preimage: inv.preimage
        })
      })

      const result = await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

      expect(result).toMatchObject({ alreadyPaid: true, preimage: null })
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })

    it('does not pay again while an earlier attempt is pending', async () => {
      const inv = invoice()
      ledger({ prior: paymentRow({ paymentHash: inv.paymentHash }) })

      const result = await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

      expect(result).toMatchObject({ status: 'PENDING', alreadyPaid: false })
      expect(result.message).toMatch(/was NOT sent again/)
      expect(result.message).toMatch(/Do NOT retry/)
      expect(result.message).toMatch(/wallet_list_payments/)
      // Too young to reconcile: the original call may still be running.
      expect(mocks.reconcile).not.toHaveBeenCalled()
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })

    it('resolves an old unknown attempt from a read-only lookup', async () => {
      const inv = invoice()
      ledger({
        prior: paymentRow({
          paymentHash: inv.paymentHash,
          status: 'UNKNOWN',
          createdAt: new Date(Date.now() - 5 * 60_000)
        })
      })
      mocks.reconcile.mockResolvedValue({
        preimage: inv.preimage,
        feesPaidSats: 2
      })

      const result = await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

      expect(mocks.reconcile).toHaveBeenCalledWith(CONNECTION, inv.paymentHash)
      expect(updates()[0]).toMatchObject({
        where: { id: 'pay-1', status: { in: ['PENDING', 'UNKNOWN'] } },
        data: { status: 'SUCCEEDED', preimage: inv.preimage, feesPaidSats: 2 }
      })
      expect(result).toMatchObject({ status: 'SUCCEEDED', alreadyPaid: true })
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })

    it('releases an old attempt the wallet reports as failed, and says a retry is possible', async () => {
      const inv = invoice()
      ledger({
        prior: paymentRow({
          paymentHash: inv.paymentHash,
          status: 'UNKNOWN',
          createdAt: new Date(Date.now() - 5 * 60_000)
        })
      })
      mocks.reconcile.mockResolvedValue('rejected')

      const error = await toolError(
        call('wallet_pay_invoice', { bolt11: inv.bolt11 })
      )

      expect(error.message).toMatch(/rejected the payment \(LOOKUP_FAILED\)/)
      expect(error.message).toMatch(
        /calling wallet_pay_invoice again retries it/
      )
      expect(error.data).toMatchObject({
        status: 'FAILED',
        budget: expect.any(Object)
      })
      expect(mocks.activity).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'nwc.mcp_payment_failed',
          level: 'WARN'
        })
      )
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })

    it('keeps an old attempt unknown when the wallet has no answer', async () => {
      const inv = invoice()
      ledger({
        prior: paymentRow({
          paymentHash: inv.paymentHash,
          status: 'UNKNOWN',
          createdAt: new Date(Date.now() - 5 * 60_000)
        })
      })

      const result = await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

      expect(result).toMatchObject({ status: 'UNKNOWN' })
      expect(prismaMock.mcpPayment.updateMany).not.toHaveBeenCalled()
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })

    it('re-claims a definitively failed invoice under a fresh id', async () => {
      // FAILED rows never block (see the findFirst filter); the claim clears it.
      ledger()
      vi.mocked(prismaMock.mcpPayment.deleteMany).mockResolvedValue({
        count: 1
      } as never)
      const inv = invoice()
      driver.payInvoice.mockResolvedValue({
        preimage: inv.preimage,
        feesPaidSats: 0
      })

      await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

      expect(prismaMock.mcpPayment.deleteMany).toHaveBeenCalledWith({
        where: {
          walletId: WALLET_ID,
          paymentHash: inv.paymentHash,
          status: 'FAILED'
        }
      })
      expect(
        vi.mocked(prismaMock.mcpPayment.deleteMany).mock.invocationCallOrder[0]
      ).toBeLessThan(
        vi.mocked(prismaMock.mcpPayment.create).mock.invocationCallOrder[0]
      )
      expect(driver.payInvoice.mock.calls[0][2]).toMatchObject({
        requestId: 'pay-new'
      })
    })

    it('does not pay when a concurrent call claimed first inside the lock', async () => {
      const inv = invoice()
      ledger()
      vi.mocked(prismaMock.mcpPayment.findFirst)
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(
          paymentRow({ paymentHash: inv.paymentHash }) as never
        )

      const result = await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

      expect(result).toMatchObject({ status: 'PENDING', alreadyPaid: false })
      expect(prismaMock.mcpPayment.create).not.toHaveBeenCalled()
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })

    it('does not pay when it loses the unique-key race to another connection', async () => {
      const inv = invoice()
      ledger()
      vi.mocked(prismaMock.$transaction).mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      )
      vi.mocked(prismaMock.mcpPayment.findFirst)
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(
          paymentRow({
            grantId: 'grant-other',
            paymentHash: inv.paymentHash
          }) as never
        )

      const result = await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

      expect(result).toMatchObject({ status: 'PENDING', alreadyPaid: false })
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })

    it('does not pay when the race winner already failed; the model may call again', async () => {
      ledger()
      vi.mocked(prismaMock.$transaction).mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
      )

      const error = await toolError(
        call('wallet_pay_invoice', { bolt11: invoice().bolt11 })
      )

      expect(error.message).toMatch(/this call sent nothing/)
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })

    it('lets other claim failures surface without paying', async () => {
      ledger()
      vi.mocked(prismaMock.$transaction).mockRejectedValueOnce(
        new Error('Database transaction timed out')
      )
      await expect(
        call('wallet_pay_invoice', { bolt11: invoice().bolt11 })
      ).rejects.toThrow('timed out')
      expect(driver.payInvoice).not.toHaveBeenCalled()
    })
  })

  describe('outcomes', () => {
    it('records a wallet rejection as FAILED and releases the budget', async () => {
      ledger()
      driver.payInvoice.mockRejectedValue(
        new PaymentRejectedError('no funds', { code: 'insufficient balance' })
      )

      const error = await toolError(
        call('wallet_pay_invoice', { bolt11: invoice().bolt11 })
      )

      expect(updates()).toEqual([
        {
          where: { id: 'pay-new', status: { in: ['PENDING', 'UNKNOWN'] } },
          data: {
            status: 'FAILED',
            error: 'INSUFFICIENT_BALANCE',
            resolvedAt: expect.any(Date)
          }
        }
      ])
      expect(error.message).toMatch(
        /rejected the payment \(INSUFFICIENT_BALANCE\). No funds were sent/
      )
      expect(error.data).toMatchObject({
        status: 'FAILED',
        paymentId: 'pay-new',
        error: 'INSUFFICIENT_BALANCE',
        budget: { limitSats: 1000 }
      })
      expect(mocks.activity).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'nwc.mcp_payment_failed',
          level: 'WARN',
          message: 'MCP payment of 100 sats rejected by the wallet'
        })
      )
      expect(driver.payInvoice).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['no code', new PaymentRejectedError('nope')],
      [
        'PAYMENT_FAILED',
        new PaymentRejectedError('timed out', { code: 'PAYMENT_FAILED' })
      ],
      ['INTERNAL', new PaymentRejectedError('hm', { code: 'INTERNAL' })]
    ])(
      'keeps the budget for an ambiguous rejection (%s)',
      async (_, failure) => {
        ledger()
        driver.payInvoice.mockRejectedValue(failure)

        const result = await call('wallet_pay_invoice', {
          bolt11: invoice().bolt11
        })

        expect(updates()).toEqual([
          {
            where: { id: 'pay-new', status: { in: ['PENDING'] } },
            data: { status: 'UNKNOWN', error: 'OUTCOME_UNKNOWN' }
          }
        ])
        expect(result).toMatchObject({ status: 'UNKNOWN', alreadyPaid: false })
      }
    )

    it.each([
      ['an unknown outcome', new PaymentOutcomeUnknownError('lost', 'DIRECT')],
      ['an unexpected error', new TypeError('boom')]
    ])('keeps the budget and says not to retry on %s', async (_, failure) => {
      ledger()
      driver.payInvoice.mockRejectedValue(failure)

      const result = await call('wallet_pay_invoice', {
        bolt11: invoice().bolt11
      })

      expect(updates()).toEqual([
        {
          where: { id: 'pay-new', status: { in: ['PENDING'] } },
          data: { status: 'UNKNOWN', error: 'OUTCOME_UNKNOWN' }
        }
      ])
      expect(result).toMatchObject({
        status: 'UNKNOWN',
        alreadyPaid: false,
        budget: { limitSats: 1000 }
      })
      expect(result.message).toMatch(/Do NOT retry/)
      expect(result.message).toMatch(/wallet_list_payments/)
      expect(mocks.activity).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'nwc.mcp_payment_sent',
          level: 'WARN',
          message: 'MCP payment of 100 sats sent, outcome unknown'
        })
      )
    })

    it('treats a malformed driver result as unknown', async () => {
      ledger()
      driver.payInvoice.mockResolvedValue(undefined)

      const result = await call('wallet_pay_invoice', {
        bolt11: invoice().bolt11
      })

      expect(result).toMatchObject({ status: 'UNKNOWN' })
    })

    it('treats a preimage that does not match the invoice as unknown', async () => {
      ledger()
      driver.payInvoice.mockResolvedValue({
        preimage: 'ff'.repeat(32),
        feesPaidSats: 0
      })

      const result = await call('wallet_pay_invoice', {
        bolt11: invoice().bolt11
      })

      expect(updates()[0]).toMatchObject({
        data: { status: 'UNKNOWN', error: 'PREIMAGE_MISMATCH' }
      })
      expect(result).toMatchObject({ status: 'UNKNOWN' })
    })

    it('stops waiting after 45 s without cancelling, and still records the late result once', async () => {
      vi.useFakeTimers()
      ledger()
      const inv = invoice()
      let finish!: (value: { preimage: string; feesPaidSats: number }) => void
      driver.payInvoice.mockReturnValue(
        new Promise(resolve => {
          finish = resolve
        })
      )

      const pending = call('wallet_pay_invoice', { bolt11: inv.bolt11 })
      await vi.advanceTimersByTimeAsync(44_999)
      expect(updates()).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      const result = await pending

      expect(result).toMatchObject({ status: 'UNKNOWN' })
      expect(result.message).toMatch(/Do NOT retry/)
      expect(updates()).toEqual([
        {
          where: { id: 'pay-new', status: { in: ['PENDING'] } },
          data: { status: 'UNKNOWN', error: 'TIMEOUT' }
        }
      ])

      finish({ preimage: inv.preimage, feesPaidSats: 3 })
      await vi.waitFor(() => expect(updates()).toHaveLength(2))
      expect(updates()[1]).toMatchObject({
        where: { status: { in: ['PENDING', 'UNKNOWN'] } },
        data: { status: 'SUCCEEDED', preimage: inv.preimage, feesPaidSats: 3 }
      })
      expect(driver.payInvoice).toHaveBeenCalledTimes(1)
    })

    it('reports the ledger state when another resolver got there first', async () => {
      ledger()
      const inv = invoice()
      driver.payInvoice.mockRejectedValue(new PaymentRejectedError('late'))
      vi.mocked(prismaMock.mcpPayment.updateMany).mockResolvedValue({
        count: 0
      } as never)
      vi.mocked(prismaMock.mcpPayment.findUnique).mockResolvedValue(
        paymentRow({
          id: 'pay-new',
          paymentHash: inv.paymentHash,
          status: 'SUCCEEDED',
          preimage: inv.preimage
        }) as never
      )

      const result = await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

      expect(result).toMatchObject({
        status: 'SUCCEEDED',
        preimage: inv.preimage
      })
      expect(mocks.activity).not.toHaveBeenCalled()
    })

    it('still returns the payment when the ledger cannot be written', async () => {
      ledger()
      const inv = invoice()
      driver.payInvoice.mockResolvedValue({
        preimage: inv.preimage,
        feesPaidSats: 0
      })
      vi.mocked(prismaMock.mcpPayment.updateMany).mockRejectedValue(
        new Error('db down')
      )
      vi.mocked(prismaMock.mcpPayment.aggregate)
        .mockResolvedValueOnce({
          _sum: { amountSats: 0, feesPaidSats: 0 }
        } as never)
        .mockRejectedValueOnce(new Error('db down'))

      const result = await call('wallet_pay_invoice', { bolt11: inv.bolt11 })

      expect(result).toMatchObject({
        status: 'SUCCEEDED',
        preimage: inv.preimage,
        budget: null
      })
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: 'pay-new' }),
        'mcp.payment_ledger_failed'
      )
      expect(mocks.activity).not.toHaveBeenCalled()
    })

    it('falls back to its own outcome when the resolved row vanished', async () => {
      ledger()
      const inv = invoice()
      driver.payInvoice.mockResolvedValue({
        preimage: inv.preimage,
        feesPaidSats: 0
      })
      vi.mocked(prismaMock.mcpPayment.updateMany).mockResolvedValue({
        count: 0
      } as never)
      vi.mocked(prismaMock.mcpPayment.findUnique).mockResolvedValue(
        null as never
      )

      await expect(
        call('wallet_pay_invoice', { bolt11: inv.bolt11 })
      ).resolves.toMatchObject({ status: 'SUCCEEDED' })
    })
  })
})

describe('wallet_list_payments', () => {
  it('lists this connection’s payments newest first with the budget', async () => {
    vi.mocked(prismaMock.mcpPayment.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        paymentRow({
          status: 'SUCCEEDED',
          preimage: 'ef'.repeat(32),
          feesPaidSats: 1,
          createdAt: new Date('2030-01-01T00:00:00Z'),
          resolvedAt: new Date('2030-01-01T00:00:05Z')
        })
      ] as never)
    vi.mocked(prismaMock.mcpPayment.aggregate).mockResolvedValue({
      _sum: { amountSats: 100, feesPaidSats: 1 }
    } as never)

    const result = await call('wallet_list_payments', {})

    expect(prismaMock.mcpPayment.findMany).toHaveBeenLastCalledWith({
      where: { grantId: GRANT_ID },
      orderBy: { createdAt: 'desc' },
      take: 20
    })
    expect(result).toEqual({
      payments: [
        {
          paymentId: 'pay-1',
          walletId: WALLET_ID,
          paymentHash: 'ab'.repeat(32),
          amountSats: 100,
          feesPaidSats: 1,
          status: 'SUCCEEDED',
          preimage: 'ef'.repeat(32),
          error: null,
          createdAt: '2030-01-01T00:00:00.000Z',
          resolvedAt: '2030-01-01T00:00:05.000Z'
        }
      ],
      budget: { limitSats: 1000, spentLast24hSats: 101, remainingSats: 899 }
    })
    expect(JSON.stringify(result)).not.toContain('bolt11')
  })

  it('re-checks old unresolved payments with the wallet before listing', async () => {
    const stale = paymentRow({
      id: 'pay-stale',
      status: 'PENDING',
      createdAt: new Date(Date.now() - 10 * 60_000)
    })
    vi.mocked(prismaMock.mcpPayment.findMany)
      .mockResolvedValueOnce([stale] as never)
      .mockResolvedValueOnce([] as never)
    vi.mocked(prismaMock.mcpPayment.aggregate).mockResolvedValue({
      _sum: { amountSats: 0, feesPaidSats: 0 }
    } as never)
    vi.mocked(prismaMock.mcpPayment.updateMany).mockResolvedValue({
      count: 1
    } as never)
    mocks.reconcile.mockResolvedValue('rejected')

    await call('wallet_list_payments', { limit: 5 })

    expect(
      vi.mocked(prismaMock.mcpPayment.findMany).mock.calls[0][0]
    ).toMatchObject({
      where: {
        grantId: GRANT_ID,
        status: { in: ['PENDING', 'UNKNOWN'] },
        createdAt: { lt: expect.any(Date) }
      },
      take: 5
    })
    expect(mocks.reconcile).toHaveBeenCalledWith(CONNECTION, stale.paymentHash)
    expect(updates()[0]).toMatchObject({
      where: { id: 'pay-stale' },
      data: { status: 'FAILED', error: 'LOOKUP_FAILED' }
    })
    expect(prismaMock.mcpPayment.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 5 })
    )
    expect(driver.payInvoice).not.toHaveBeenCalled()
  })

  it.each([
    [
      'the wallet is gone',
      () => {
        vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
          null as never
        )
      }
    ],
    [
      'the wallet is not NWC',
      () => {
        vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
          walletRow({ type: 'LND' }) as never
        )
      }
    ],
    [
      'its configuration cannot be read',
      () => {
        mocks.driverForWallet.mockImplementation(() => {
          throw new DriverRemoteError('vault')
        })
      }
    ]
  ])('leaves an old payment unresolved when %s', async (_, arrange) => {
    arrange()
    vi.mocked(prismaMock.mcpPayment.findMany)
      .mockResolvedValueOnce([
        paymentRow({ status: 'UNKNOWN', createdAt: new Date(0) })
      ] as never)
      .mockResolvedValueOnce([] as never)
    vi.mocked(prismaMock.mcpPayment.aggregate).mockResolvedValue({
      _sum: { amountSats: 0, feesPaidSats: 0 }
    } as never)

    await call('wallet_list_payments', {})

    expect(mocks.reconcile).not.toHaveBeenCalled()
    expect(prismaMock.mcpPayment.updateMany).not.toHaveBeenCalled()
  })

  it('gives up on a lookup that does not answer in time', async () => {
    vi.useFakeTimers()
    vi.mocked(prismaMock.mcpPayment.findMany)
      .mockResolvedValueOnce([
        paymentRow({ status: 'UNKNOWN', createdAt: new Date(0) })
      ] as never)
      .mockResolvedValueOnce([] as never)
    vi.mocked(prismaMock.mcpPayment.aggregate).mockResolvedValue({
      _sum: { amountSats: 0, feesPaidSats: 0 }
    } as never)
    mocks.reconcile.mockReturnValue(new Promise(() => {}))

    const pending = call('wallet_list_payments', {})
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(pending).resolves.toMatchObject({ payments: [] })
    expect(prismaMock.mcpPayment.updateMany).not.toHaveBeenCalled()
  })

  it('shows a zero budget for a connection that cannot spend', async () => {
    vi.mocked(prismaMock.mcpPayment.findMany).mockResolvedValue([] as never)
    vi.mocked(prismaMock.mcpPayment.aggregate).mockResolvedValue({
      _sum: { amountSats: null, feesPaidSats: null }
    } as never)

    const result = await call(
      'wallet_list_payments',
      {},
      makeCaller({
        scopes: ['read'],
        grant: { id: GRANT_ID, clientName: 'Claude', spendLimitSats: null }
      })
    )

    expect(result.budget).toEqual({
      limitSats: 0,
      spentLast24hSats: 0,
      remainingSats: 0
    })
  })

  it('explains that session and device tokens have no payment ledger', async () => {
    const error = await toolError(
      call('wallet_list_payments', {}, makeCaller({ grant: null }))
    )
    expect(error.message).toMatch(/per OAuth app connection/)
    expect(prismaMock.mcpPayment.findMany).not.toHaveBeenCalled()
  })
})

describe('feeReserveSats', () => {
  it('reserves 1% of the amount, at least 10 sats', () => {
    expect(feeReserveSats(1)).toBe(10)
    expect(feeReserveSats(1000)).toBe(10)
    expect(feeReserveSats(1001)).toBe(11)
    expect(feeReserveSats(250_000)).toBe(2500)
  })
})
