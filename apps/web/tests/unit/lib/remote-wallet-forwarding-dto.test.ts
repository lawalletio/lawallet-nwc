import { describe, expect, it } from 'vitest'
import {
  forwardReceiptToDto,
  type ForwardReceiptRow
} from '@/lib/remote-wallet-forwarding/dto'

function blockedReceipt(lastError: string | null): ForwardReceiptRow {
  const now = new Date('2026-08-04T00:00:00.000Z')
  return {
    id: 'receipt-1',
    walletId: 'wallet-1',
    eventKey: 'event-1',
    sourcePaymentHash: 'aa'.repeat(32),
    sourceInvoice: null,
    grossAmountMsats: BigInt(2_000),
    retainedFeeMsats: BigInt(0),
    targetAmountMsats: BigInt(2_000),
    forwardedAmountMsats: BigInt(0),
    routingFeeMsats: BigInt(0),
    routingReserveMsats: BigInt(0),
    unusedRoutingReserveMsats: BigInt(0),
    routingFeeOverageMsats: BigInt(0),
    shortfallMsats: BigInt(0),
    configRevision: 3,
    status: 'BLOCKED',
    recovered: false,
    sourceSettledAt: now,
    lastError,
    nextRetryAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    legs: []
  }
}

describe('forwardReceiptToDto', () => {
  it('reconstructs the reason for legacy blocked receipts without legs', () => {
    expect(forwardReceiptToDto(blockedReceipt(null)).lastError).toBe(
      'Pending amount is too small to forward. It will be retried when more funds arrive.'
    )
  })

  it('keeps a more specific persisted error', () => {
    expect(
      forwardReceiptToDto(blockedReceipt('Listener reported an invalid event'))
        .lastError
    ).toBe('Listener reported an invalid event')
  })

  it('exposes the shared batch attempt on every contributing leg', () => {
    const receipt = blockedReceipt(null)
    receipt.status = 'FORWARDING'
    receipt.legs = [
      {
        id: 'member-leg',
        position: 0,
        destination: 'alice@example.com',
        allocationBps: 10_000,
        requestedAmountMsats: BigInt(2_000),
        forwardedAmountMsats: null,
        routingFeeMsats: null,
        routingReserveMsats: BigInt(0),
        unusedRoutingReserveMsats: BigInt(0),
        routingFeeOverageMsats: BigInt(0),
        destinationShortfallMsats: BigInt(0),
        status: 'PENDING',
        retryCount: 0,
        nextRetryAt: receipt.nextRetryAt,
        lastError: null,
        createdAt: receipt.createdAt,
        completedAt: null,
        batchAnchorId: 'anchor-leg',
        attempts: [],
        batchAnchor: {
          attempts: [
            {
              id: 'attempt-1',
              attemptNo: 1,
              bolt11: 'lnbc1batch',
              paymentHash: 'bb'.repeat(32),
              amountMsats: BigInt(8_000),
              requestId: 'request-1',
              status: 'PENDING',
              preimage: null,
              routingFeeMsats: null,
              routingReserveMsats: BigInt(2_000),
              errorCode: null,
              errorMessage: null,
              expiresAt: receipt.nextRetryAt,
              createdAt: receipt.createdAt,
              resolvedAt: null
            }
          ]
        }
      }
    ]

    const dto = forwardReceiptToDto(receipt)

    expect(dto.legs[0].batchAnchorId).toBe('anchor-leg')
    expect(dto.legs[0].attempts).toEqual([
      expect.objectContaining({ id: 'attempt-1', amountMsats: 8_000 })
    ])
  })
})
