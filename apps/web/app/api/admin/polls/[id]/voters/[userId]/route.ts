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
 * PATCH /api/admin/polls/{id}/voters/{userId} — dismiss (or restore) a vote.
 * Dismissed responses stay listed but drop out of every tally.
 */
export const PATCH = withErrorHandling(
  async (
    request: Request,
    ctx: { params: Promise<{ id: string; userId: string }> }
  ) => {
    await checkRequestLimits(request, 'json')
    await authenticateWithRole(request, Role.ADMIN)
    const { id, userId } = validateParams(await ctx.params, pollVoterParam)
    const { dismissed } = await validateBody(request, dismissPollVoterSchema)

    const where = { pollId_userId: { pollId: id, userId } }
    const response = await prisma.pollResponse.findUnique({
      where,
      select: { updatedAt: true }
    })
    if (!response) throw new NotFoundError('Response not found')

    await prisma.pollResponse.update({
      where,
      // Keep updatedAt: dismissing is not the voter answering again.
      data: {
        dismissedAt: dismissed ? new Date() : null,
        updatedAt: response.updatedAt
      }
    })
    return NextResponse.json({ userId, dismissed })
  }
)
