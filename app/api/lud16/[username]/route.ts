import { LUD06Response } from '@/types/lnurl'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'

export const GET = withErrorHandling(
  async (req: NextRequest, { params }: { params: { username: string } }) => {
    const _username = params.username
    const username = _username.trim().toLowerCase()

    console.info('LUD16 username:', username)

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
    const domain = req.headers.get('host') || 'localhost:3000'
    const { endpoint } = await getSettings(['endpoint'])
    const callback = `${endpoint}/api/lud16/${username}/cb`

    return NextResponse.json({
      status: 'OK',
      tag: 'payRequest',
      callback,
      minSendable: 1000, // 1 satoshi in msats
      maxSendable: 1000000000, // 1,000,000 sats in msats
      metadata: JSON.stringify([
        ['text/plain', `Payment to @${username} on ${domain}`]
      ]),
      commentAllowed: 200,
      payerData: {
        name: { mandatory: false },
        email: { mandatory: false }
      }
    } as LUD06Response)
  }
)
