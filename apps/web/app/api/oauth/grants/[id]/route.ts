import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { idParam, oauthGrantUpdateSchema } from '@/lib/validation/schemas'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { resolveAccountId } from '@/lib/auth/account'
import { NotFoundError } from '@/types/server/errors'
import {
  authenticateSession,
  revokeUserGrant,
  updateUserGrant
} from '@/lib/oauth/grants'

export const dynamic = 'force-dynamic'

/**
 * `DELETE /api/oauth/grants/[id]` — disconnects one of the caller's apps. Its
 * tokens stop working at once; the row is kept for the MCP payment ledger.
 */
export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await authenticateSession(request)
    const { id } = validateParams(await params, idParam)
    const userId = await resolveAccountId(auth.pubkey)
    if (!userId) throw new NotFoundError('Authorization not found')

    await revokeUserGrant(id, userId)
    return NextResponse.json({ success: true })
  }
)

/**
 * `PATCH /api/oauth/grants/[id]` — changes what one of the caller's apps may
 * do: scopes, daily spend budget and which wallets it reaches. Takes effect on
 * the app's next MCP call; its tokens keep working.
 */
export const PATCH = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    const auth = await authenticateSession(request)
    const { id } = validateParams(await params, idParam)
    const body = await validateBody(request, oauthGrantUpdateSchema)
    const userId = await resolveAccountId(auth.pubkey)
    if (!userId) throw new NotFoundError('Authorization not found')

    const grant = await updateUserGrant(id, userId, body)
    return NextResponse.json({ grant })
  }
)
