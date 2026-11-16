import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import {
  dismissPollVoterSchema,
  pollVoterParam
} from '@/lib/validation/schemas'
import { NotFoundError } from '@/types/server/errors'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * PATCH /api/admin/polls/voters/{userId} — dismiss (or restore) a voter in
 * every poll. Their responses stay listed but drop out of every tally.
 */
export const PATCH = withErrorHandling(
  async (request: Request, ctx: { params: Promise<{ userId: string }> }) => {
    await checkRequestLimits(request, 'json')
    await authenticateWithRole(request, Role.ADMIN)
    const { userId } = validateParams(await ctx.params, pollVoterParam)
    const { dismissed } = await validateBody(request, dismissPollVoterSchema)

    const { count } = await prisma.user.updateMany({
      where: { id: userId },
      data: { pollsDismissedAt: dismissed ? new Date() : null }
    })
    if (!count) throw new NotFoundError('User not found')
    return NextResponse.json({ userId, dismissed })
  }
)
