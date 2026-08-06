import { after, NextResponse } from 'next/server'
import { remoteWalletNotificationDeliveryParamsSchema } from '@lawallet-nwc/shared'
import { requireUserId } from '@/lib/auth/account'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { reconcileRemoteWalletNotifications } from '@/lib/remote-wallet-notifications/reconcile'
import { retryRemoteWalletNotificationDelivery } from '@/lib/remote-wallet-notifications/service'
import { validateParams } from '@/lib/validation/middleware'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'

export const POST = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; deliveryId: string }> }
  ) => {
    await rateLimit(request, RateLimitPresets.sensitive)
    const userId = await requireUserId(request)
    const { id, deliveryId } = validateParams(
      await params,
      remoteWalletNotificationDeliveryParamsSchema
    )
    const result = await retryRemoteWalletNotificationDelivery(
      id,
      deliveryId,
      userId
    )
    after(() => reconcileRemoteWalletNotifications({ ids: [deliveryId] }))
    return NextResponse.json(result, { status: 202 })
  }
)
