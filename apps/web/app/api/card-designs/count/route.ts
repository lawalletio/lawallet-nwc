import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.CARD_DESIGNS_READ)
  const count = await prisma.cardDesign.count()
  return NextResponse.json({ count })
})
