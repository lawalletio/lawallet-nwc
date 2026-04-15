import { LUD06Response } from '@/types/lnurl'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { lud16UsernameParam, LUD12_MAX_COMMENT_LENGTH } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { resolvePublicEndpoint } from '@/lib/public-url'

export const GET = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ username: string }> }) => {
    const { username: _username } = validateParams(await params, lud16UsernameParam)
    const username = _username.trim().toLowerCase()

    logger.info({ username }, 'LUD16 lookup request')

    // Look for the user with that lightning address
    const lightningAddress = await prisma.lightningAddress.findUnique({
      where: { username },
      include: {
        user: {
          select: {
            id: true,
            nwc: true
          }
        }
      }
    })

    // If not found, return 404
    if (!lightningAddress) {
      throw new NotFoundError('Lightning address not found')
    }

    // If user doesn't have an nwc string, return 404
    if (!lightningAddress.user.nwc) {
      throw new NotFoundError('User not configured for payments')
    }

    // LUD-16 (LNURLp) response
    // See: https://github.com/lnurl/luds/blob/luds/lud-16.md
    const { host, url } = await resolvePublicEndpoint(req)
    const callback = `${url}/api/lud16/${username}/cb`

    return NextResponse.json({
      status: 'OK',
      tag: 'payRequest',
      callback,
      minSendable: 1000, // 1 satoshi in msats
      maxSendable: 1000000000, // 1,000,000 sats in msats
      metadata: JSON.stringify([
        ['text/plain', `Payment to @${username} on ${host}`]
      ]),
      // LUD-12: declare the max comment length we accept on the callback.
      // See: https://github.com/lnurl/luds/blob/luds/12.md
      commentAllowed: LUD12_MAX_COMMENT_LENGTH,
      payerData: {
        name: { mandatory: false },
        email: { mandatory: false }
      }
    } as LUD06Response)
  }
)
