import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.ADDRESSES_READ)

  const [total, withNWC, withoutNWC] = await Promise.all([
    prisma.lightningAddress.count(),
    prisma.lightningAddress.count({
      where: {
        user: {
          nwc: { not: null },
        },
      },
    }),
    prisma.lightningAddress.count({
      where: {
        user: {
          nwc: null,
        },
      },
    }),
  ])

  return NextResponse.json({
    total,
    withNWC,
    withoutNWC,
  })
})
