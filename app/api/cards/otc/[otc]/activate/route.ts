import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateNip98 } from '@/lib/nip98'
import { createNewUser } from '@/lib/user'
import { getSettings } from '@/lib/settings'

export async function POST(
  request: Request,
  { params }: { params: { otc: string } }
) {
  try {
    const { pubkey } = await validateNip98(request)
    const { otc } = params

    if (!pubkey) {
      return NextResponse.json(
        { error: 'Public key is required' },
        { status: 400 }
      )
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
  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
