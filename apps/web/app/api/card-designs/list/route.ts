import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { CardDesign } from '@/types/card-design'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.CARD_DESIGNS_READ)
  const designs = await prisma.cardDesign.findMany({
    select: {
      id: true,
      imageUrl: true,
      description: true,
      createdAt: true,
      archivedAt: true,
    },
    orderBy: {
      createdAt: 'desc'
    }
  })

  return NextResponse.json(designs as CardDesign[])
})
