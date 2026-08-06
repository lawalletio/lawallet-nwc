import { NextResponse } from 'next/server'
import { createRemoteWalletNotificationSchema } from '@lawallet-nwc/shared'
import { requireUserId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import {
  createRemoteWalletNotification,
  listRemoteWalletNotifications
} from '@/lib/remote-wallet-notifications/service'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { idParam } from '@/lib/validation/schemas'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'

async function userIdFor(request: Request): Promise<string> {
  const userId = await requireUserId(request)
  return userId
}

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const userId = await requireUserId(request)
    const { id } = validateParams(await params, idParam)
    return NextResponse.json(await listRemoteWalletNotifications(id, userId))
  }
)

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    const userId = await requireUserId(request)
    const { id } = validateParams(await params, idParam)
    const body = await validateBody(
      request,
      createRemoteWalletNotificationSchema
    )
    return NextResponse.json(
      await createRemoteWalletNotification(id, userId, body),
      { status: 201 }
    )
  }
)
