import { LUD06Response } from '@/types/lnurl'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const ENDPOINT = process.env.NEXT_PUBLIC_ENDPOINT || 'http://localhost:3000'

export async function GET(
  req: NextRequest,
  { params }: { params: { username: string } }
) {
  const _username = params.username
  const username = _username.trim().toLowerCase()

  console.info('LUD16 username:', username)

  try {
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
      return NextResponse.json(
        { error: 'Lightning address not found' },
        { status: 404 }
      )
    }

    // If user doesn't have an nwc string, return 404
    if (!lightningAddress.user.nwc) {
      return NextResponse.json(
        { error: 'User not configured for payments' },
        { status: 404 }
      )
    }

    // LUD-16 (LNURLp) response
    // See: https://github.com/lnurl/luds/blob/luds/lud-16.md
    const domain = req.headers.get('host') || 'localhost:3000'
    const callback = `${ENDPOINT}/api/lud16/${username}/cb`

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
  } catch (error) {
    console.error('Error in LUD16 route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
