import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CardPaymentAttempt } from '@/lib/generated/prisma'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  claimCardPaymentAttempt,
  createCardPaymentRequestId,
  type ClaimCardPaymentAttemptInput
} from '@/lib/card-payments/attempts'

const input: ClaimCardPaymentAttemptInput = {
  cardId: 'card-1',
  ntag424Cid: '01020304050607',
  counter: 9,
  walletId: 'wallet-1',
  paymentHash: 'ab'.repeat(32),
  bolt11: 'lnbc1invoice',
  amountMsats: 21_000,
  transport: 'DIRECT'
}

function attempt(
  overrides: Partial<CardPaymentAttempt> = {}
): CardPaymentAttempt {
  return {
    id: 'attempt-1',
    requestId: createCardPaymentRequestId(input.walletId, input.paymentHash),
    cardId: input.cardId,
    counter: input.counter,
    walletId: input.walletId,
    paymentHash: input.paymentHash,
    bolt11: input.bolt11,
    amountMsats: input.amountMsats,
    transport: input.transport,
    status: 'PENDING',
    preimage: null,
    feesPaidMsats: null,
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    resolvedAt: null,
    ...overrides
  }
}

beforeEach(() => {
  resetPrismaMock()
})

describe('atomic card payment attempt claim', () => {
  it('returns the row created by the counter-claim CTE', async () => {
    const created = attempt()
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([created] as never)

    await expect(claimCardPaymentAttempt(input)).resolves.toEqual({
      outcome: 'CREATED',
      attempt: created
    })
    expect(prismaMock.cardPaymentAttempt.findMany).not.toHaveBeenCalled()
  })

  it('reattaches an exact callback retry without advancing anything again', async () => {
    const existing = attempt()
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([] as never)
    vi.mocked(prismaMock.cardPaymentAttempt.findMany).mockResolvedValue([
      existing
    ] as never)

    await expect(claimCardPaymentAttempt(input)).resolves.toEqual({
      outcome: 'EXISTING',
      attempt: existing
    })
  })

  it('rejects the same counter carrying a different invoice as a replay', async () => {
    const existing = attempt({ bolt11: 'lnbc1different' })
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([] as never)
    vi.mocked(prismaMock.cardPaymentAttempt.findMany).mockResolvedValue([
      existing
    ] as never)

    await expect(claimCardPaymentAttempt(input)).resolves.toEqual({
      outcome: 'REPLAY',
      attempt: existing
    })
  })

  it('keeps a newer tap unconsumed while an earlier payment is unresolved', async () => {
    const otherHash = 'cd'.repeat(32)
    const unresolved = attempt({
      counter: 8,
      paymentHash: otherHash,
      requestId: createCardPaymentRequestId(input.walletId, otherHash)
    })
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([] as never)
    vi.mocked(prismaMock.cardPaymentAttempt.findMany).mockResolvedValue([
      unresolved
    ] as never)

    await expect(claimCardPaymentAttempt(input)).resolves.toEqual({
      outcome: 'BUSY',
      attempt: unresolved
    })
  })

  it('classifies a lower or equal counter as stale when there is no matching attempt', async () => {
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([] as never)
    vi.mocked(prismaMock.cardPaymentAttempt.findMany).mockResolvedValue([])
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue({
      ntag424: { ctr: 12 }
    } as never)

    await expect(claimCardPaymentAttempt(input)).resolves.toEqual({
      outcome: 'STALE_COUNTER',
      storedCounter: 12
    })
  })
})
