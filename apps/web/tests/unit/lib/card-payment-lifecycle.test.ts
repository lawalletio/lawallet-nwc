import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  markCardPaymentUnknown,
  rejectCardPaymentAttempt,
  succeedCardPaymentAttempt
} from '@/lib/card-payments/lifecycle'

const paymentHash =
  '02d449a31fbb267c8f352e9968a79e3e5fc95c1bbeaa502fd6454ebde5a4bedc'

beforeEach(() => {
  resetPrismaMock()
  vi.mocked(prismaMock.cardPaymentAttempt.updateMany).mockResolvedValue({
    count: 1
  })
})

describe('card payment lifecycle transport guards', () => {
  it('cannot move a durable DIRECT hand-off back to LISTENER while marking unknown', async () => {
    await markCardPaymentUnknown('attempt-1', 'LISTENER_PENDING', 'LISTENER')

    expect(prismaMock.cardPaymentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'attempt-1',
          transport: 'LISTENER'
        })
      })
    )
  })

  it('applies the same compare-and-set guard to terminal rejection', async () => {
    await rejectCardPaymentAttempt('attempt-1', 'WALLET_REJECTED', 'LISTENER')

    expect(prismaMock.cardPaymentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ transport: 'LISTENER' })
      })
    )
  })

  it('persists success only on the transport that produced the preimage', async () => {
    await succeedCardPaymentAttempt(
      { id: 'attempt-1', paymentHash },
      {
        preimage: '11'.repeat(32),
        feesPaidSats: 0,
        feesPaidMsats: 0,
        transport: 'DIRECT'
      },
      'LISTENER'
    )

    expect(prismaMock.cardPaymentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ transport: 'DIRECT' }),
        data: expect.objectContaining({
          status: 'SUCCEEDED',
          transport: 'DIRECT'
        })
      })
    )
  })
})
