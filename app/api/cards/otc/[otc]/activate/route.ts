import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNewUser } from '@/lib/user'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  ValidationError
} from '@/types/server/errors'
import { otcParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { authenticate } from '@/lib/auth/unified-auth'

export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ otc: string }> }) => {
    await checkRequestLimits(request, 'json')
    // Apply strict rate limiting for card activation (sensitive operation)
    await rateLimit(request, RateLimitPresets.sensitive)

    const { pubkey } = await authenticate(request)
    const { otc } = validateParams(await params, otcParam)

    if (!pubkey) {
      throw new ValidationError('Public key is required')
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { pubkey },
      include: {
        lightningAddress: true,
        albySubAccount: true
      }
    })

    const user = existingUser || (await createNewUser(pubkey))
    // If OTC is provided, try to assign a card to this user
    if (otc) {
      const card = await prisma.card.findFirst({
        where: {
          otc: otc
          // TODO: Unless there is a specific user lock, whoever scans the otc will get the card
          // userId: null // Only assign unassigned cards
        }
      })

      if (card) {
        await prisma.card.update({
          where: { id: card.id },
          data: { userId: user.id }
        })
      }
    }

    const { domain } = await getSettings(['domain'])
    const lightningAddress = user.lightningAddress?.username
      ? `${user.lightningAddress.username}@${domain}`
      : null

    return NextResponse.json({
      userId: user.id,
      lightningAddress,
      albySubAccount: user.albySubAccount
        ? {
            appId: user.albySubAccount.appId,
            nwcUri: user.albySubAccount.nwcUri,
            username: user.albySubAccount.username
          }
        : null,
      nwcString: user.albySubAccount ? user.albySubAccount.nwcUri : ''
    })
  }
)
