import { createHash, randomUUID } from 'node:crypto'
import type {
  CardPaymentAttempt,
  CardPaymentTransport
} from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'

const MAX_NTAG_COUNTER = 0xffffff
const MAX_POSTGRES_INTEGER = 0x7fffffff

export interface ClaimCardPaymentAttemptInput {
  cardId: string
  ntag424Cid: string
  counter: number
  walletId: string
  paymentHash: string
  bolt11: string
  amountMsats: number
  transport: CardPaymentTransport
}

export type ClaimCardPaymentAttemptResult =
  | { outcome: 'CREATED'; attempt: CardPaymentAttempt }
  | { outcome: 'EXISTING'; attempt: CardPaymentAttempt }
  | { outcome: 'BUSY'; attempt: CardPaymentAttempt }
  | { outcome: 'REPLAY'; attempt: CardPaymentAttempt }
  | { outcome: 'CONFLICT'; attempt: CardPaymentAttempt }
  | { outcome: 'STALE_COUNTER'; storedCounter: number }
  | { outcome: 'CARD_NOT_FOUND' }

/**
 * Stable operation id shared by web and the optional listener. Payment hashes
 * are hex and case-insensitive, so normalising them prevents two ids for the
 * same NWC payment.
 */
export function createCardPaymentRequestId(
  walletId: string,
  paymentHash: string
): string {
  if (!walletId) throw new TypeError('walletId is required')
  if (!/^[0-9a-f]{64}$/i.test(paymentHash)) {
    throw new TypeError('paymentHash must be 32-byte hex')
  }

  return createHash('sha256')
    .update(`${walletId}|${paymentHash.toLowerCase()}`)
    .digest('hex')
}

function validateClaimInput(input: ClaimCardPaymentAttemptInput): void {
  if (!input.cardId) throw new TypeError('cardId is required')
  if (!input.ntag424Cid) throw new TypeError('ntag424Cid is required')
  if (
    !Number.isInteger(input.counter) ||
    input.counter < 0 ||
    input.counter > MAX_NTAG_COUNTER
  ) {
    throw new TypeError('counter must be a 24-bit unsigned integer')
  }
  if (!input.bolt11) throw new TypeError('bolt11 is required')
  if (
    !Number.isInteger(input.amountMsats) ||
    input.amountMsats <= 0 ||
    input.amountMsats > MAX_POSTGRES_INTEGER
  ) {
    throw new TypeError('amountMsats must be a positive PostgreSQL integer')
  }
}

function isSamePayment(
  attempt: CardPaymentAttempt,
  input: ClaimCardPaymentAttemptInput,
  requestId: string,
  paymentHash: string
): boolean {
  return (
    attempt.requestId === requestId &&
    attempt.cardId === input.cardId &&
    attempt.counter === input.counter &&
    attempt.walletId === input.walletId &&
    attempt.paymentHash.toLowerCase() === paymentHash &&
    attempt.bolt11 === input.bolt11 &&
    attempt.amountMsats === input.amountMsats
  )
}

/**
 * Atomically claims an authenticated SUN counter for one payment.
 *
 * The data-modifying CTE inserts the attempt first and only advances the NTAG
 * counter/touches the card when that insert succeeds. `ON CONFLICT DO NOTHING`
 * covers all three idempotency constraints plus the migration's partial
 * one-unresolved-attempt index. This ordering is important: a duplicate or a
 * busy card can never consume a newer tap counter.
 *
 * If the insert loses a concurrent race, the follow-up read attaches an exact
 * retry to the winning attempt and classifies every other collision without
 * dispatching a second payment.
 */
export async function claimCardPaymentAttempt(
  input: ClaimCardPaymentAttemptInput
): Promise<ClaimCardPaymentAttemptResult> {
  validateClaimInput(input)

  const paymentHash = input.paymentHash.toLowerCase()
  const requestId = createCardPaymentRequestId(input.walletId, paymentHash)
  const attemptId = randomUUID()

  const inserted = await prisma.$queryRaw<CardPaymentAttempt[]>`
    WITH candidate AS MATERIALIZED (
      SELECT c."id", n."cid"
      FROM "Card" AS c
      INNER JOIN "Ntag424" AS n ON n."cid" = c."ntag424Cid"
      WHERE c."id" = ${input.cardId}
        AND n."cid" = ${input.ntag424Cid}
        AND n."ctr" < CAST(${input.counter} AS INTEGER)
      FOR UPDATE OF c, n
    ), inserted AS (
      INSERT INTO "CardPaymentAttempt" (
        "id",
        "requestId",
        "cardId",
        "counter",
        "walletId",
        "paymentHash",
        "bolt11",
        "amountMsats",
        "transport",
        "status",
        "createdAt",
        "updatedAt"
      )
      SELECT
        ${attemptId},
        ${requestId},
        candidate."id",
        CAST(${input.counter} AS INTEGER),
        ${input.walletId},
        ${paymentHash},
        ${input.bolt11},
        CAST(${input.amountMsats} AS INTEGER),
        CAST(${input.transport} AS "CardPaymentTransport"),
        'PENDING'::"CardPaymentStatus",
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM candidate
      ON CONFLICT DO NOTHING
      RETURNING *
    ), counter_advanced AS (
      UPDATE "Ntag424" AS n
      SET "ctr" = CAST(${input.counter} AS INTEGER)
      FROM inserted
      WHERE n."cid" = ${input.ntag424Cid}
      RETURNING n."cid"
    ), card_touched AS (
      UPDATE "Card" AS c
      SET "lastUsedAt" = CURRENT_TIMESTAMP
      FROM counter_advanced
      WHERE c."id" = ${input.cardId}
      RETURNING c."id"
    )
    SELECT inserted.*
    FROM inserted
    INNER JOIN counter_advanced ON TRUE
    INNER JOIN card_touched ON TRUE
  `

  if (inserted[0]) return { outcome: 'CREATED', attempt: inserted[0] }

  // A single fresh snapshot is enough here: ON CONFLICT waits for a concurrent
  // winner before the CTE returns, so its row is visible to this next query.
  const candidates = await prisma.cardPaymentAttempt.findMany({
    where: {
      OR: [
        { requestId },
        { cardId: input.cardId, counter: input.counter },
        { walletId: input.walletId, paymentHash },
        {
          cardId: input.cardId,
          status: { in: ['PENDING', 'UNKNOWN'] }
        }
      ]
    }
  })

  const exact = candidates.find(
    attempt =>
      isSamePayment(attempt, input, requestId, paymentHash) ||
      (attempt.cardId === input.cardId &&
        attempt.counter === input.counter &&
        attempt.paymentHash.toLowerCase() === paymentHash &&
        attempt.bolt11 === input.bolt11 &&
        attempt.amountMsats === input.amountMsats)
  )
  if (exact) return { outcome: 'EXISTING', attempt: exact }

  const replay = candidates.find(
    attempt =>
      attempt.cardId === input.cardId && attempt.counter === input.counter
  )
  if (replay) return { outcome: 'REPLAY', attempt: replay }

  const uniqueConflict = candidates.find(
    attempt =>
      attempt.requestId === requestId ||
      (attempt.walletId === input.walletId &&
        attempt.paymentHash.toLowerCase() === paymentHash)
  )
  if (uniqueConflict) return { outcome: 'CONFLICT', attempt: uniqueConflict }

  const busy = candidates.find(
    attempt =>
      attempt.cardId === input.cardId &&
      (attempt.status === 'PENDING' || attempt.status === 'UNKNOWN')
  )
  if (busy) return { outcome: 'BUSY', attempt: busy }

  const card = await prisma.card.findFirst({
    where: { id: input.cardId, ntag424Cid: input.ntag424Cid },
    select: { ntag424: { select: { ctr: true } } }
  })
  if (!card?.ntag424) return { outcome: 'CARD_NOT_FOUND' }

  return { outcome: 'STALE_COUNTER', storedCounter: card.ntag424.ctr }
}

/** Atomically advances a non-payment action's SUN counter and last-used time. */
export async function claimCardTap(
  cardId: string,
  ntag424Cid: string,
  counter: number
): Promise<boolean> {
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_NTAG_COUNTER) {
    throw new TypeError('counter must be a 24-bit unsigned integer')
  }
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH counter_advanced AS (
      UPDATE "Ntag424"
      SET "ctr" = CAST(${counter} AS INTEGER)
      WHERE "cid" = ${ntag424Cid}
        AND "ctr" < CAST(${counter} AS INTEGER)
      RETURNING "cid"
    )
    UPDATE "Card"
    SET "lastUsedAt" = CURRENT_TIMESTAMP
    FROM counter_advanced
    WHERE "Card"."id" = ${cardId}
      AND "Card"."ntag424Cid" = counter_advanced."cid"
    RETURNING "Card"."id"
  `
  return rows.length === 1
}
