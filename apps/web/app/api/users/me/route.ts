import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNewUser } from '@/lib/user'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolvePublicEndpoint } from '@/lib/public-url'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandling(async (request: Request) => {
  const { pubkey: authenticatedPubkey } = await authenticate(request)

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

    // Resolve host with subdomain fallback (subdomain empty → use domain)
    const { host } = await resolvePublicEndpoint(request)
    const lightningAddress = user.lightningAddress?.username
      ? `${user.lightningAddress.username}@${host}`
      : null

  // Prefer user-set NWC (via PUT /api/users/[id]/nwc), fall back to
  // auto-provisioned Alby sub-account if available.
  const nwcString = user.nwc ?? user.albySubAccount?.nwcUri ?? ''
  const nwcUpdatedAt = user.nwc
    ? user.nwcUpdatedAt?.toISOString() ?? null
    : user.albySubAccount?.createdAt?.toISOString() ?? null

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
    nwcString,
    nwcUpdatedAt,
  })
})
