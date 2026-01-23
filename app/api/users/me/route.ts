import { validateNip98 } from '@/lib/nip98'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNewUser } from '@/lib/user'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthenticationError } from '@/types/server/errors'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandling(async (request: Request) => {
  let authenticatedPubkey: string
  try {
    const { pubkey } = await validateNip98(request)
    authenticatedPubkey = pubkey
  } catch (error) {
    throw new AuthenticationError()
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
})
