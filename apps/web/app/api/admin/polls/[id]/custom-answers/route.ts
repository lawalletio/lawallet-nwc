import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { idParam, renameCustomAnswerSchema } from '@/lib/validation/schemas'
import { NotFoundError } from '@/types/server/errors'
import { mergeCustomAlias } from '@/lib/polls'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * PUT /api/admin/polls/{id}/custom-answers — rename a custom answer; renaming
 * it to another answer's text merges their tallies. Responses are untouched.
 */
export const PUT = withErrorHandling(
  async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    await authenticateWithRole(request, Role.ADMIN)
    const { id } = validateParams(await ctx.params, idParam)
    const { from, to } = await validateBody(request, renameCustomAnswerSchema)

    // ponytail: read-modify-write; two admins merging at once can drop one.
    const poll = await prisma.poll.findUnique({
      where: { id },
      select: { customAliases: true }
    })
    if (!poll) throw new NotFoundError('Poll not found')

    const customAliases = mergeCustomAlias(
      poll.customAliases as Record<string, string>,
      from,
      to
    )
    await prisma.poll.update({ where: { id }, data: { customAliases } })
    return NextResponse.json({ customAliases })
  }
)
