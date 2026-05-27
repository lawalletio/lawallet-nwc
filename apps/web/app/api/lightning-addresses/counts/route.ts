import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.ADDRESSES_READ)

  // "withNWC" now means the address's owner has at least one usable
  // (non-revoked) RemoteWallet — i.e. the address can route a payment.
  const usableWallet = { some: { status: { not: 'REVOKED' as const } } }
  const [total, withNWC, withoutNWC] = await Promise.all([
    prisma.lightningAddress.count(),
    prisma.lightningAddress.count({
      where: { user: { remoteWallets: usableWallet } },
    }),
    prisma.lightningAddress.count({
      where: { user: { remoteWallets: { none: { status: { not: 'REVOKED' } } } } },
    }),
  ])

  return NextResponse.json({
    total,
    withNWC,
    withoutNWC,
  })
})
