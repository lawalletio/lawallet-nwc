import { NextResponse } from 'next/server'
import {
  remoteWalletNotificationParamsSchema,
  remoteWalletNotificationToggleSchema
} from '@lawallet-nwc/shared'
import { requireUserId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { setRemoteWalletNotificationEnabled } from '@/lib/remote-wallet-notifications/service'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'

export const PATCH = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; notificationId: string }> }
  ) => {
    await checkRequestLimits(request, 'json')
    const userId = await requireUserId(request)
    const { id, notificationId } = validateParams(
      await params,
      remoteWalletNotificationParamsSchema
    )
    const body = await validateBody(
      request,
      remoteWalletNotificationToggleSchema
    )
    return NextResponse.json(
      await setRemoteWalletNotificationEnabled(
        id,
        notificationId,
        userId,
        body.enabled
      )
    )
  }
)
