import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { CardDesign } from '@/types/card-design'
import { validateAdminAuth } from '@/lib/admin-auth'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandling(async (request: Request) => {
  await validateAdminAuth(request)
  const designs = await prisma.cardDesign.findMany({
    select: {
      id: true,
      imageUrl: true,
      description: true,
      createdAt: true
    },
    orderBy: {
      createdAt: 'desc'
    }
  })

  return NextResponse.json(designs as CardDesign[])
})
