import { z } from 'zod'
import type { McpPayment, Prisma, RemoteWallet } from '@/lib/generated/prisma'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { preimageMatchesPaymentHash } from '@/lib/card-payments/lifecycle'
import {
  extractAmountSats,
  extractExpiry,
  extractPaymentHash,
  parseExactPaymentInvoice
} from '@/lib/invoice-utils'
import { logger } from '@/lib/logger'
import {
  McpToolError,
  type JsonSchema,
  type McpCaller,
  type NativeTool
} from '@/lib/mcp/types'
import { prisma } from '@/lib/prisma'
import {
  fetchDestinationMetadata,
  requestDestinationInvoice
} from '@/lib/proxy/lnurl'
import { loadOwnedRemoteWallet } from '@/lib/remote-wallets/owned'
import { LUD12_MAX_COMMENT_LENGTH } from '@/lib/validation/schemas'
import {
  DriverError,
  PaymentRejectedError,
  driverForWallet,
  reconcileDirectNwcPayment
} from '@/lib/wallet/drivers'
import { nwcWalletCanSend } from '@/lib/wallet/nwc-send-capability'
import { getPrimaryRemoteWalletForUser } from '@/lib/wallet/primary-wallet'
import { parseLightningAddress } from '@/lib/wallet/resolve-payment-route'
import { NotFoundError } from '@/types/server/errors'

const DAY_MS = 24 * 60 * 60 * 1000
/** Sanity cap on amount arguments; the grant budget is the real spend limit. */
const MAX_AMOUNT_SATS = 100_000_000
/**
 * The MCP route may run 60 s and a direct NWC payment can take that long
 * inside the driver, so the tool stops waiting earlier — without cancelling
 * the payment — and reports the outcome as unknown.
 */
const PAY_WAIT_MS = 45_000
const WALLET_WAIT_MS = 30_000
const RECONCILE_WAIT_MS = 5_000
/**
 * A younger payment may still be running in the driver (60 s timeout), which
 * records its own result; a lookup then only adds relay load.
 */
const RECONCILE_AFTER_MS = 60_000
const MAX_RECONCILED_PER_CALL = 5

const OUTCOME_UNKNOWN =
  'The payment was handed to the wallet but its outcome is not known yet, so the funds may already have left. Do NOT retry and do NOT pay another invoice for the same purpose. Check wallet_list_payments in a few minutes.'
const STILL_UNRESOLVED =
  'This invoice is already being paid from this account and was NOT sent again; its outcome is not known yet. Do NOT retry and do NOT pay another invoice for the same purpose. Check wallet_list_payments in a few minutes.'

const TIMED_OUT = Symbol('timed out')

/** Resolves with TIMED_OUT after `ms`; the operation itself keeps running. */
function waitAtMost<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>(resolve => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** One Zod schema both advertises the tool's input and validates it. */
function defineTool<S extends z.ZodType>(
  spec: Omit<NativeTool, 'inputSchema' | 'handler'> & {
    input: S
    run: (args: z.infer<S>, caller: McpCaller) => Promise<unknown>
  }
): NativeTool {
  const { input, run, ...descriptor } = spec
  return {
    ...descriptor,
    inputSchema: z.toJSONSchema(input, { io: 'input' }) as JsonSchema,
    handler: async (args, caller) => {
      const parsed = input.safeParse(args ?? {})
      if (!parsed.success) {
        const issues = parsed.error.issues.map(
          issue => `${issue.path.join('.') || 'arguments'}: ${issue.message}`
        )
        throw new McpToolError(`Invalid arguments — ${issues.join('; ')}`)
      }
      return run(parsed.data, caller)
    }
  }
}

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}

// --- Wallet resolution -------------------------------------------------------

function requireAccount(caller: McpCaller): string {
  const userId = caller.user?.userId
  if (!userId) {
    throw new McpToolError(
      'This Nostr identity has no LaWallet account on this instance yet, so it has no wallets.'
    )
  }
  return userId
}

/**
 * The caller's wallet: the one named by `walletId`, else the account's
 * primary wallet. Another account's wallet reads exactly like a missing one.
 */
async function resolveWallet(
  caller: McpCaller,
  walletId: string | undefined
): Promise<RemoteWallet> {
  const userId = requireAccount(caller)
  let wallet: RemoteWallet | null
  if (walletId) {
    try {
      wallet = await loadOwnedRemoteWallet(walletId, userId)
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err
      throw new McpToolError(
        `Wallet ${walletId} not found. Call list_wallets to see this account's wallets.`
      )
    }
  } else {
    wallet = await getPrimaryRemoteWalletForUser(userId)
    if (!wallet || wallet.userId !== userId) {
      throw new McpToolError(
        'No walletId was given and this account has no primary wallet. Call list_wallets and pass a walletId.'
      )
    }
  }
  if (wallet.status !== 'ACTIVE') {
    throw new McpToolError(
      `Wallet "${wallet.name}" is ${wallet.status.toLowerCase()} and cannot be used. Call list_wallets and pick an active wallet.`
    )
  }
  return wallet
}

function walletDriver(wallet: RemoteWallet) {
  try {
    return driverForWallet(wallet)
  } catch (err) {
    logger.error({ err, walletId: wallet.id }, 'mcp.wallet_config_invalid')
    throw new McpToolError(
      `Wallet "${wallet.name}" is misconfigured and cannot be used right now.`
    )
  }
}

/** Bounded read from the wallet; a driver failure becomes `failure`. */
async function callWallet<T>(
  call: () => Promise<T>,
  failure: string
): Promise<T> {
  try {
    const result = await waitAtMost(call(), WALLET_WAIT_MS)
    if (result !== TIMED_OUT) return result
  } catch (err) {
    if (!(err instanceof DriverError)) throw err
    logger.warn({ err }, 'mcp.wallet_call_failed')
  }
  throw new McpToolError(failure)
}

// --- Spend ledger ------------------------------------------------------------

type PrismaLike = typeof prisma | Prisma.TransactionClient

export interface SpendBudget {
  limitSats: number
  spentLast24hSats: number
  remainingSats: number
}

/**
 * Rolling-24h budget of an OAuth grant. PENDING and UNKNOWN payments count —
 * their funds may have left — and so do recorded routing fees; only FAILED
 * payments (the wallet definitively refused) are released.
 */
export async function readSpendBudget(
  grantId: string,
  limitSats: number,
  client: PrismaLike = prisma
): Promise<SpendBudget> {
  const { _sum } = await client.mcpPayment.aggregate({
    where: {
      grantId,
      status: { not: 'FAILED' },
      createdAt: { gte: new Date(Date.now() - DAY_MS) }
    },
    _sum: { amountSats: true, feesPaidSats: true }
  })
  const spent = (_sum.amountSats ?? 0) + (_sum.feesPaidSats ?? 0)
  return {
    limitSats,
    spentLast24hSats: spent,
    remainingSats: Math.max(0, limitSats - spent)
  }
}

interface SpendGrant {
  id: string
  clientName: string
  limitSats: number
}

/** Re-checked here although the MCP layer gates on scope: money path. */
function requireSpendGrant(caller: McpCaller): SpendGrant {
  const { grant } = caller
  if (!grant) {
    throw new McpToolError(
      'Sending payments needs an app connected through OAuth with the "Send payments" permission; session and device tokens can never spend.'
    )
  }
  if (!caller.scopes.has('spend')) {
    throw new McpToolError(
      'This connection may not send payments: it lacks the spend scope. Reconnect the app and enable "Send payments" with a daily limit.'
    )
  }
  if (!grant.spendLimitSats || grant.spendLimitSats <= 0) {
    throw new McpToolError(
      'This connection has no daily spend limit, so it cannot send payments. Reconnect the app and set one.'
    )
  }
  return {
    id: grant.id,
    clientName: grant.clientName,
    limitSats: grant.spendLimitSats
  }
}

/**
 * Payments that block paying this invoice again: from this wallet (the unique
 * key), or from any wallet of the account — the same invoice paid from two
 * wallets is still paid twice. A FAILED payment blocks nothing.
 *
 * ponytail: the account-wide check is serialised only per grant (its row
 * lock); two connections of one account paying the same invoice from two
 * different wallets at the same instant could both claim. Lock the User row
 * in claimPayment if that ever matters.
 */
function blockingPayment(
  userId: string,
  walletId: string,
  paymentHash: string
): Prisma.McpPaymentWhereInput {
  return {
    paymentHash,
    status: { not: 'FAILED' },
    OR: [{ walletId }, { userId }]
  }
}

interface PayableInvoice {
  bolt11: string
  paymentHash: string
  /** Charged to the budget: the invoice amount rounded up to whole sats. */
  amountSats: number
  /** Handed to the driver for zero-amount invoices only. */
  payAmountSats?: number
  expiresAt: number
}

function decodePayableInvoice(
  raw: string,
  amountSats: number | undefined
): PayableInvoice {
  const bolt11 = raw.replace(/^lightning:/i, '').toLowerCase()
  if (extractAmountSats(bolt11) !== null) {
    // The verified decoder checks the signature and gives exact msats.
    let invoice: ReturnType<typeof parseExactPaymentInvoice>
    try {
      invoice = parseExactPaymentInvoice(bolt11)
    } catch (err) {
      throw new McpToolError(`Invalid invoice: ${(err as Error).message}.`)
    }
    if (amountSats !== undefined && amountSats * 1000 !== invoice.amountMsats) {
      throw new McpToolError(
        `The invoice is for ${invoice.amountMsats / 1000} sats but amountSats is ${amountSats}. Omit amountSats: it is only for invoices without an amount.`
      )
    }
    return {
      bolt11,
      paymentHash: invoice.paymentHash,
      amountSats: Math.ceil(invoice.amountMsats / 1000),
      expiresAt: invoice.expiresAt
    }
  }
  // Zero-amount: the verified decoder insists on an amount, so use the light
  // one. Budget and idempotency need only the hash and our own amount, and
  // the wallet still verifies the signature before paying.
  const paymentHash = extractPaymentHash(bolt11)
  if (!paymentHash || !/^[0-9a-f]{64}$/.test(paymentHash)) {
    throw new McpToolError(
      'Invalid invoice: not a decodable BOLT11 Lightning invoice.'
    )
  }
  if (amountSats === undefined) {
    throw new McpToolError(
      'This invoice does not specify an amount: pass amountSats, the amount in sats the user asked to pay.'
    )
  }
  return {
    bolt11,
    paymentHash,
    amountSats,
    payAmountSats: amountSats,
    expiresAt: extractExpiry(bolt11).getTime()
  }
}

type Claim =
  | { kind: 'claimed'; payment: McpPayment }
  | { kind: 'existing'; payment: McpPayment }
  | { kind: 'over_budget'; budget: SpendBudget }

/**
 * Checks the budget and records the payment as PENDING in one transaction,
 * before anything reaches the wallet. The grant row lock serialises this
 * grant's claims, so two payments can't both fit into the last of its
 * budget; `@@unique([walletId, paymentHash])` arbitrates between grants.
 */
async function claimPayment(
  grant: SpendGrant,
  userId: string,
  walletId: string,
  invoice: PayableInvoice
): Promise<Claim> {
  const { paymentHash } = invoice
  try {
    return await prisma.$transaction(async (tx): Promise<Claim> => {
      await tx.$queryRaw`
        SELECT "id" FROM "OAuthGrant" WHERE "id" = ${grant.id} FOR UPDATE
      `
      // Read after the lock: the token was verified before this call, and the
      // grant may have been revoked since.
      const locked = await tx.oAuthGrant.findUnique({
        where: { id: grant.id },
        select: {
          userId: true,
          scopes: true,
          spendLimitSats: true,
          revokedAt: true
        }
      })
      if (
        !locked ||
        locked.revokedAt ||
        locked.userId !== userId ||
        !locked.scopes.includes('spend') ||
        !locked.spendLimitSats
      ) {
        throw new McpToolError(
          'This connection was revoked or may no longer send payments. Nothing was sent.'
        )
      }
      const prior = await tx.mcpPayment.findFirst({
        where: blockingPayment(userId, walletId, paymentHash)
      })
      if (prior) return { kind: 'existing', payment: prior }

      const budget = await readSpendBudget(grant.id, locked.spendLimitSats, tx)
      if (invoice.amountSats > budget.remainingSats) {
        return { kind: 'over_budget', budget }
      }
      // A retry after a definitive failure replaces the FAILED row: the new
      // one's fresh id matters, since the NWC driver joins in-flight payments
      // by requestId (the row id) and would replay the failed attempt.
      await tx.mcpPayment.deleteMany({
        where: { walletId, paymentHash, status: 'FAILED' }
      })
      const payment = await tx.mcpPayment.create({
        data: {
          grantId: grant.id,
          userId,
          walletId,
          paymentHash,
          bolt11: invoice.bolt11,
          amountSats: invoice.amountSats
        }
      })
      return { kind: 'claimed', payment }
    })
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== 'P2002') throw err
    // A concurrent claim from another connection inserted this wallet and
    // hash first. It owns the payment; this call must not dispatch one.
    const winner = await prisma.mcpPayment.findFirst({
      where: blockingPayment(userId, walletId, paymentHash)
    })
    if (winner) return { kind: 'existing', payment: winner }
    throw new McpToolError(
      'Another attempt to pay this invoice was being recorded at the same moment; this call sent nothing. Call wallet_pay_invoice again to see its outcome.'
    )
  }
}

type Outcome =
  | { status: 'SUCCEEDED'; preimage: string; feesPaidSats: number }
  | { status: 'FAILED' | 'UNKNOWN'; error: string }

function outcomeOf(error: unknown): Outcome {
  if (error instanceof PaymentRejectedError) {
    const code = (error.code ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    return { status: 'FAILED', error: code.slice(0, 64) || 'WALLET_REJECTED' }
  }
  // PaymentOutcomeUnknownError, or anything else once the driver was invoked:
  // the payment may be out there.
  logger.error({ err: error }, 'mcp.payment_outcome_unknown')
  return { status: 'UNKNOWN', error: 'OUTCOME_UNKNOWN' }
}

/**
 * Resolves a ledger row exactly once. The status predicate lets the bounded
 * wait, the late driver result and a reconciliation race safely: nothing
 * overwrites a final state, and each transition is logged once. Never throws —
 * if the write fails the row stays unresolved (budget held) until
 * reconciliation, and the caller still learns what happened.
 */
async function settle(
  payment: McpPayment,
  outcome: Outcome,
  grant: SpendGrant
): Promise<McpPayment> {
  if (
    outcome.status === 'SUCCEEDED' &&
    !preimageMatchesPaymentHash(outcome.preimage, payment.paymentHash)
  ) {
    logger.error({ paymentId: payment.id }, 'mcp.payment_preimage_mismatch')
    outcome = { status: 'UNKNOWN', error: 'PREIMAGE_MISMATCH' }
  }
  const data =
    outcome.status === 'SUCCEEDED'
      ? {
          status: outcome.status,
          preimage: outcome.preimage.toLowerCase(),
          feesPaidSats: outcome.feesPaidSats,
          error: null,
          resolvedAt: new Date()
        }
      : {
          status: outcome.status,
          error: outcome.error,
          ...(outcome.status === 'FAILED' ? { resolvedAt: new Date() } : {})
        }
  const next: McpPayment = { ...payment, ...data }
  try {
    const { count } = await prisma.mcpPayment.updateMany({
      where: {
        id: payment.id,
        status: {
          in:
            outcome.status === 'UNKNOWN' ? ['PENDING'] : ['PENDING', 'UNKNOWN']
        }
      },
      data
    })
    if (count === 0) {
      return (
        (await prisma.mcpPayment.findUnique({ where: { id: payment.id } })) ??
        next
      )
    }
    logOutcome(next, grant)
  } catch (err) {
    logger.error({ err, paymentId: payment.id }, 'mcp.payment_ledger_failed')
  }
  return next
}

function logOutcome(payment: McpPayment, grant: SpendGrant): void {
  const failed = payment.status === 'FAILED'
  const what = failed
    ? 'rejected by the wallet'
    : payment.status === 'SUCCEEDED'
      ? 'sent'
      : 'sent, outcome unknown'
  logActivity.fireAndForget({
    category: 'NWC',
    // UNKNOWN is logged as sent, at WARN: the funds may have left.
    event: failed
      ? ActivityEvent.MCP_PAYMENT_FAILED
      : ActivityEvent.MCP_PAYMENT_SENT,
    level: payment.status === 'SUCCEEDED' ? 'INFO' : 'WARN',
    userId: payment.userId,
    message: `MCP payment of ${payment.amountSats} sats ${what}`,
    metadata: {
      paymentId: payment.id,
      grantId: payment.grantId,
      clientName: payment.grantId === grant.id ? grant.clientName : undefined,
      walletId: payment.walletId,
      paymentHash: payment.paymentHash,
      amountSats: payment.amountSats,
      feesPaidSats: payment.feesPaidSats,
      status: payment.status,
      error: payment.error
    }
  })
}

/**
 * Asks the wallet, read-only, what became of an unresolved payment and
 * records a definitive answer. Never dispatches anything.
 */
async function reconcile(
  payment: McpPayment,
  grant: SpendGrant
): Promise<McpPayment> {
  if (
    (payment.status !== 'PENDING' && payment.status !== 'UNKNOWN') ||
    Date.now() - payment.createdAt.getTime() < RECONCILE_AFTER_MS
  ) {
    return payment
  }
  try {
    const wallet = await prisma.remoteWallet.findUnique({
      where: { id: payment.walletId },
      select: { id: true, type: true, config: true }
    })
    if (wallet?.type !== 'NWC') return payment
    const { config } = driverForWallet(wallet)
    const found = await waitAtMost(
      reconcileDirectNwcPayment(
        (config as { connectionString: string }).connectionString,
        payment.paymentHash
      ),
      RECONCILE_WAIT_MS
    )
    if (found === 'rejected') {
      return await settle(
        payment,
        { status: 'FAILED', error: 'LOOKUP_FAILED' },
        grant
      )
    }
    if (found && found !== TIMED_OUT) {
      return await settle(
        payment,
        {
          status: 'SUCCEEDED',
          preimage: found.preimage,
          feesPaidSats: found.feesPaidSats
        },
        grant
      )
    }
  } catch (err) {
    logger.warn({ err, paymentId: payment.id }, 'mcp.payment_reconcile_failed')
  }
  return payment
}

async function reportPayment(
  payment: McpPayment,
  grant: SpendGrant,
  repeated: boolean
): Promise<Record<string, unknown>> {
  // The outcome matters more than the budget figure: never lose it to a read.
  const budget = await readSpendBudget(grant.id, grant.limitSats).catch(err => {
    logger.error({ err }, 'mcp.spend_budget_read_failed')
    return null
  })
  const summary = {
    status: payment.status,
    paymentId: payment.id,
    walletId: payment.walletId,
    paymentHash: payment.paymentHash,
    amountSats: payment.amountSats,
    budget
  }
  if (payment.status === 'FAILED') {
    throw new McpToolError(
      `The wallet rejected the payment (${payment.error}). No funds were sent and the budget was not charged; once the cause is fixed, calling wallet_pay_invoice again retries it.`,
      { ...summary, error: payment.error }
    )
  }
  if (payment.status === 'SUCCEEDED') {
    return {
      ...summary,
      alreadyPaid: repeated,
      message: repeated
        ? 'This invoice was already paid; it was not paid again.'
        : 'Payment sent.',
      feesPaidSats: payment.feesPaidSats,
      // The payer's receipt: only for the connection that paid.
      preimage: payment.grantId === grant.id ? payment.preimage : null
    }
  }
  return {
    ...summary,
    alreadyPaid: false,
    message: repeated ? STILL_UNRESOLVED : OUTCOME_UNKNOWN
  }
}

/**
 * Order: validate → resolve wallet → answer a repeat from the ledger → check
 * send capability and expiry → claim (budget + PENDING row, one transaction)
 * → pay with requestId = row id → resolve the row exactly once. Nothing
 * before the claim can dispatch, and nothing after it dispatches again.
 */
async function payWithinBudget(
  args: { bolt11: string; amountSats?: number; walletId?: string },
  caller: McpCaller
): Promise<Record<string, unknown>> {
  const grant = requireSpendGrant(caller)
  const userId = requireAccount(caller)
  const invoice = decodePayableInvoice(args.bolt11, args.amountSats)
  const wallet = await resolveWallet(caller, args.walletId)

  // A repeat is answered from the ledger — even once the invoice expired or
  // the wallet lost its send permission.
  const prior = await prisma.mcpPayment.findFirst({
    where: blockingPayment(userId, wallet.id, invoice.paymentHash)
  })
  if (prior) return reportPayment(await reconcile(prior, grant), grant, true)

  const { driver, config } = walletDriver(wallet)
  if (
    wallet.type === 'NWC' &&
    !(await nwcWalletCanSend({ walletId: wallet.id, config }))
  ) {
    throw new McpToolError(
      `Wallet "${wallet.name}" cannot send payments: its connection does not grant pay_invoice, or the wallet could not be reached to confirm it.`
    )
  }
  if (invoice.expiresAt <= Date.now()) {
    throw new McpToolError(
      'This invoice has expired. Ask the payee for a new one.'
    )
  }

  const claim = await claimPayment(grant, userId, wallet.id, invoice)
  if (claim.kind === 'existing') {
    return reportPayment(await reconcile(claim.payment, grant), grant, true)
  }
  if (claim.kind === 'over_budget') {
    const { budget } = claim
    throw new McpToolError(
      `Paying ${invoice.amountSats} sats would exceed this connection's daily budget: ${budget.remainingSats} of ${budget.limitSats} sats left in the last 24 hours. Nothing was sent. The user can reconnect the app with a higher limit, or wait for earlier payments to leave the 24-hour window.`,
      { amountSats: invoice.amountSats, budget }
    )
  }

  const { payment } = claim
  logger.info(
    { paymentId: payment.id, walletId: wallet.id, grantId: grant.id },
    'mcp.payment_claimed'
  )
  // Records the wallet's answer whenever it comes, even after we stop waiting.
  const outcome = Promise.resolve()
    .then(() =>
      driver.payInvoice(
        config,
        { bolt11: invoice.bolt11, amountSats: invoice.payAmountSats },
        {
          walletId: wallet.id,
          requestId: payment.id,
          paymentHash: payment.paymentHash
        }
      )
    )
    .then((result): Outcome => ({
      status: 'SUCCEEDED',
      preimage: result.preimage,
      feesPaidSats: result.feesPaidSats
    }))
    .catch(outcomeOf)
    .then(result => settle(payment, result, grant))
  const settled = await waitAtMost(outcome, PAY_WAIT_MS)
  return reportPayment(
    settled === TIMED_OUT
      ? await settle(payment, { status: 'UNKNOWN', error: 'TIMEOUT' }, grant)
      : settled,
    grant,
    false
  )
}

// --- Tools -------------------------------------------------------------------

const walletIdArg = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .optional()
  .describe(
    "Wallet id from list_wallets; defaults to the account's primary wallet"
  )
const amountSatsArg = z.number().int().positive().max(MAX_AMOUNT_SATS)

/**
 * Wallet tools served by the wallet driver layer (NWC methods) rather than by
 * a REST operation: balance, invoices, and budgeted spending.
 */
export const walletTools: NativeTool[] = [
  defineTool({
    name: 'wallet_get_balance',
    title: 'Get wallet balance',
    description:
      "Get the spendable balance, in sats, of one of the user's wallets. Uses the account's primary wallet unless walletId is given (see list_wallets).",
    scope: 'read',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
    },
    input: z.strictObject({ walletId: walletIdArg }),
    run: async ({ walletId }, caller) => {
      const wallet = await resolveWallet(caller, walletId)
      const { driver, config } = walletDriver(wallet)
      const { balanceSats } = await callWallet(
        () => driver.getBalance(config),
        `Could not read the balance of wallet "${wallet.name}": the wallet is unreachable or refused the request.`
      )
      return { walletId: wallet.id, walletName: wallet.name, balanceSats }
    }
  }),

  defineTool({
    name: 'wallet_make_invoice',
    title: 'Create an invoice',
    description:
      "Create a BOLT11 Lightning invoice that pays into one of the user's wallets, so someone can pay the user. amountSats is the amount in sats; description is an optional memo embedded in the invoice. Uses the account's primary wallet unless walletId is given. Check whether it was paid with wallet_lookup_invoice.",
    scope: 'write',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    input: z.strictObject({
      amountSats: amountSatsArg.describe('Amount to receive, in sats'),
      description: z
        .string()
        .trim()
        .max(500)
        .optional()
        .describe('Memo embedded in the invoice'),
      walletId: walletIdArg
    }),
    run: async ({ amountSats, description, walletId }, caller) => {
      const wallet = await resolveWallet(caller, walletId)
      const { driver, config } = walletDriver(wallet)
      const invoice = await callWallet(
        () => driver.makeInvoice(config, { amountSats, description }),
        `Wallet "${wallet.name}" could not create the invoice: it is unreachable or does not allow receiving.`
      )
      return {
        walletId: wallet.id,
        bolt11: invoice.bolt11,
        paymentHash: invoice.paymentHash,
        amountSats: invoice.amountSats,
        expiresAt: toIso(invoice.expiresAt)
      }
    }
  }),

  defineTool({
    name: 'wallet_lookup_invoice',
    title: 'Check an invoice',
    description:
      "Check whether an invoice created by one of the user's wallets has been paid, by its payment hash (64 hex characters, as returned by wallet_make_invoice). Returns settled, the preimage (proof of payment) once settled, and when it settled. Uses the account's primary wallet unless walletId is given.",
    scope: 'read',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
    },
    input: z.strictObject({
      paymentHash: z
        .string()
        .trim()
        .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters')
        .toLowerCase()
        .describe('Payment hash of the invoice, 64 hex characters'),
      walletId: walletIdArg
    }),
    run: async ({ paymentHash, walletId }, caller) => {
      const wallet = await resolveWallet(caller, walletId)
      const { driver, config } = walletDriver(wallet)
      const lookupInvoice = driver.lookupInvoice?.bind(driver)
      if (!lookupInvoice) {
        throw new McpToolError(
          `Wallet "${wallet.name}" does not support invoice lookups.`
        )
      }
      const result = await callWallet(
        () => lookupInvoice(config, { paymentHash }),
        `Wallet "${wallet.name}" could not look up this payment hash: the invoice may not belong to this wallet, or the wallet is unreachable.`
      )
      return {
        walletId: wallet.id,
        paymentHash,
        settled: result.settled,
        preimage: result.preimage,
        settledAt: toIso(result.settledAt)
      }
    }
  }),

  defineTool({
    name: 'lightning_address_get_invoice',
    title: 'Get an invoice from a Lightning Address',
    description:
      'Request a BOLT11 invoice for amountSats sats from any Lightning Address (name@domain) through LNURL-pay. No funds move: this only fetches an invoice, which wallet_pay_invoice can pay if the user asked to pay. comment is an optional note for the recipient, sent only when their service accepts comments. The invoice may be up to 10 sats below the requested amount if the recipient rounds it.',
    scope: 'read',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
    },
    input: z.strictObject({
      address: z
        .string()
        .trim()
        .min(3)
        .max(320)
        .describe('Lightning Address, like name@example.com'),
      amountSats: amountSatsArg.describe('Amount to request, in sats'),
      comment: z
        .string()
        .trim()
        .max(LUD12_MAX_COMMENT_LENGTH)
        .optional()
        .describe('Optional note for the recipient')
    }),
    run: async ({ address, amountSats, comment }) => {
      if (!parseLightningAddress(address)) {
        throw new McpToolError(
          `"${address}" is not a valid Lightning Address (expected name@domain).`
        )
      }
      const amountMsats = amountSats * 1000
      let invoice: Awaited<ReturnType<typeof requestDestinationInvoice>>
      try {
        // SSRF-guarded: HTTPS only, private networks refused, DNS pinned.
        const metadata = await fetchDestinationMetadata(address)
        if (
          amountMsats < metadata.minSendable ||
          amountMsats > metadata.maxSendable
        ) {
          throw new McpToolError(
            `${address} accepts between ${Math.ceil(metadata.minSendable / 1000)} and ${Math.floor(metadata.maxSendable / 1000)} sats.`
          )
        }
        invoice = await requestDestinationInvoice({
          metadata,
          amountMsats,
          comment
        })
      } catch (err) {
        if (err instanceof McpToolError) throw err
        throw new McpToolError(
          `Could not get an invoice from ${address}: ${String((err as Error)?.message ?? err).slice(0, 200)}`
        )
      }
      return {
        address,
        bolt11: invoice.bolt11,
        paymentHash: invoice.paymentHash,
        amountSats: invoice.amountMsats / 1000,
        expiresAt: invoice.expiresAt.toISOString()
      }
    }
  }),

  defineTool({
    name: 'wallet_pay_invoice',
    title: 'Pay an invoice',
    description:
      "Pay a BOLT11 Lightning invoice from the user's wallet. This sends real bitcoin irrevocably: call it only when the user has explicitly asked to make this payment. Amounts are in sats. Every payment counts against the daily budget (rolling 24 hours, fees included) the user set when connecting this app; the result shows what remains. Pass amountSats only for an invoice without an amount of its own. Uses the account's primary wallet unless walletId is given. Calling again with the same invoice never pays it twice: it returns the stored result. If the status is PENDING or UNKNOWN, do not retry and do not pay another invoice for the same purpose; check wallet_list_payments later.",
    scope: 'spend',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    },
    input: z.strictObject({
      bolt11: z
        .string()
        .trim()
        .min(1)
        .max(8192)
        .describe('BOLT11 invoice to pay'),
      amountSats: amountSatsArg
        .optional()
        .describe(
          'Amount in sats, only for an invoice without an amount; omit it otherwise'
        ),
      walletId: walletIdArg
    }),
    run: payWithinBudget
  }),

  defineTool({
    name: 'wallet_list_payments',
    title: 'List sent payments',
    description:
      'List the payments this app connection sent with wallet_pay_invoice, newest first, with status (SUCCEEDED, FAILED, PENDING or UNKNOWN), amount and fees in sats, plus the daily spend budget: limit, spent in the last 24 hours, and remaining. Unresolved payments are re-checked with the wallet first.',
    scope: 'read',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true
    },
    input: z.strictObject({
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe('How many payments to return, newest first')
    }),
    run: async ({ limit }, caller) => {
      if (!caller.grant) {
        throw new McpToolError(
          'Payments are recorded per OAuth app connection, and this caller is not one, so there is nothing to list.'
        )
      }
      const grant: SpendGrant = {
        id: caller.grant.id,
        clientName: caller.grant.clientName,
        limitSats: caller.grant.spendLimitSats ?? 0
      }
      const stale = await prisma.mcpPayment.findMany({
        where: {
          grantId: grant.id,
          status: { in: ['PENDING', 'UNKNOWN'] },
          createdAt: { lt: new Date(Date.now() - RECONCILE_AFTER_MS) }
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_RECONCILED_PER_CALL
      })
      await Promise.all(stale.map(payment => reconcile(payment, grant)))
      const [payments, budget] = await Promise.all([
        prisma.mcpPayment.findMany({
          where: { grantId: grant.id },
          orderBy: { createdAt: 'desc' },
          take: limit
        }),
        readSpendBudget(grant.id, grant.limitSats)
      ])
      return {
        payments: payments.map(payment => ({
          paymentId: payment.id,
          walletId: payment.walletId,
          paymentHash: payment.paymentHash,
          amountSats: payment.amountSats,
          feesPaidSats: payment.feesPaidSats,
          status: payment.status,
          preimage: payment.preimage,
          error: payment.error,
          createdAt: payment.createdAt.toISOString(),
          resolvedAt: payment.resolvedAt?.toISOString() ?? null
        })),
        budget
      }
    }
  })
]
