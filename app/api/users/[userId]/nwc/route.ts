import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthorizationError,
  NotFoundError,
} from '@/types/server/errors'
import { userIdParam, updateNwcSchema } from '@/lib/validation/schemas'
import { validateParams, validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { authenticate } from '@/lib/auth/unified-auth'

export const PUT = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ userId: string }> }) => {
    await checkRequestLimits(request, 'json')
    const { pubkey: authenticatedPubkey } = await authenticate(request)

    const { nwcUri } = await validateBody(request, updateNwcSchema)
    const { userId } = validateParams(await params, userIdParam)

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId }
    })

    if (!user) {
      throw new NotFoundError('User not found')
    }

    if (user.pubkey !== authenticatedPubkey) {
      throw new AuthorizationError('Not authorized to update this user')
    }

    // Update the user's NWC URI
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { nwc: nwcUri }
    })

    return NextResponse.json({
      userId: updatedUser.id,
      nwcUri: updatedUser.nwc,
      updated: true
    })
  }
)
