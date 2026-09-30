import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { validateParams } from '@/lib/validation/middleware'
import { idParam } from '@/lib/validation/schemas'
import { resolveAccountId } from '@/lib/auth/account'
import { NotFoundError } from '@/types/server/errors'
import { authenticateSession, revokeUserGrant } from '@/lib/oauth/grants'

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
