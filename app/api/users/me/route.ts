import { validateNip98 } from '@/lib/nip98'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNewUser } from '@/lib/user'

export async function GET(request: Request) {
  try {
    let authenticatedPubkey: string
    try {
      const { pubkey } = await validateNip98(request)
      authenticatedPubkey = pubkey
    } catch (error) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        pubkey: authenticatedPubkey
      },
      include: {
        lightningAddress: true,
        albySubAccount: true
      }
    })

    const user = existingUser || (await createNewUser(authenticatedPubkey))

    // Get domain from environment or use default
    const domain = process.env.NEXT_PUBLIC_DOMAIN || 'localhost:3000'
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
    console.error('Error in GET /api/users/me:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
