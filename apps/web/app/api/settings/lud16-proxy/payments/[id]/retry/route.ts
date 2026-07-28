import { after, NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateSettingsWriteRequest } from '@/lib/settings-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, ValidationError } from '@/types/server/errors'
import { reconcileProxyPayments } from '@/lib/proxy/reconcile'

export const POST = withErrorHandling(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    await authenticateSettingsWriteRequest(request)
    const { id } = await params
    if (!id) throw new ValidationError('Payment id is required')
    const updated = await prisma.proxyPayment.updateMany({
      where: {
        id,
        status: {
          in: [
            'PENDING_INBOUND',
            'READY_TO_FORWARD',
            'FORWARDING',
            'RECEIPT_PENDING',
            'BLOCKED'
          ]
        },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }]
      },
      data: {
        nextRetryAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null
      }
    })
    if (updated.count === 0) {
      const exists = await prisma.proxyPayment.findUnique({ where: { id } })
      if (!exists) throw new NotFoundError('Proxy payment not found')
      throw new ValidationError(
        'Payment is completed, expired, or currently being reconciled'
      )
    }
    after(async () => {
      await reconcileProxyPayments({ ids: [id] })
    })
    return NextResponse.json({ accepted: true, id })
  }
)
