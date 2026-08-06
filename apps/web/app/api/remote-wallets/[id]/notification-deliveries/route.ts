import { NextResponse } from 'next/server'
import { remoteWalletNotificationListQuerySchema } from '@lawallet-nwc/shared'
import { requireUserId } from '@/lib/auth/account'
import { listRemoteWalletNotificationDeliveries } from '@/lib/remote-wallet-notifications/service'
import { validateParams, validateQuery } from '@/lib/validation/middleware'
import { idParam } from '@/lib/validation/schemas'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const userId = await requireUserId(request)
    const { id } = validateParams(await params, idParam)
    const query = validateQuery(
      request.url,
      remoteWalletNotificationListQuerySchema
    )
    return NextResponse.json(
      await listRemoteWalletNotificationDeliveries(id, userId, query)
    )
  }
)
