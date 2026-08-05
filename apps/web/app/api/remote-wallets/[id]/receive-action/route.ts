import { after, NextResponse } from 'next/server'
import {
  remoteWalletReceiveActionConfigSchema,
  remoteWalletReceiveActionToggleSchema
} from '@lawallet-nwc/shared'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import {
  getReceiveActionDto,
  putReceiveAction,
  setReceiveActionEnabled
} from '@/lib/remote-wallet-forwarding/service'
import { reconcileRemoteWalletForwarding } from '@/lib/remote-wallet-forwarding/reconcile'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { idParam } from '@/lib/validation/schemas'
import { NotFoundError } from '@/types/server/errors'
import { withErrorHandling } from '@/types/server/error-handler'

async function userIdFor(request: Request): Promise<string> {
  const auth = await authenticate(request)
  const userId = await resolveAccountId(auth.pubkey)
  if (!userId) throw new NotFoundError('User not found')
  return userId
}

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const userId = await userIdFor(request)
    const { id } = validateParams(await params, idParam)
    return NextResponse.json(await getReceiveActionDto(id, userId))
  }
)

export const PUT = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    const userId = await userIdFor(request)
    const { id } = validateParams(await params, idParam)
    const body = await validateBody(
      request,
      remoteWalletReceiveActionConfigSchema
    )
    const action = await putReceiveAction(id, userId, body)
    if (action.enabled) {
      after(() => reconcileRemoteWalletForwarding({ walletIds: [id] }))
    }
    return NextResponse.json(action)
  }
)

export const PATCH = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    const userId = await userIdFor(request)
    const { id } = validateParams(await params, idParam)
    const body = await validateBody(
      request,
      remoteWalletReceiveActionToggleSchema
    )
    const action = await setReceiveActionEnabled(id, userId, body.enabled)
    if (body.enabled) {
      // Resuming makes every expired receipt eligible immediately. Wake the
      // same lease-protected worker used by webhook + cron so funds do not sit
      // idle until the next scheduled sweep and concurrent resumes remain
      // incapable of dispatching the same invoice twice.
      after(() => reconcileRemoteWalletForwarding({ walletIds: [id] }))
    }
    return NextResponse.json(action)
  }
)
