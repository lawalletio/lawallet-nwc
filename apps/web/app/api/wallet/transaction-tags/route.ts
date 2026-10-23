import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth/account'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId(request)
  const saved = await prisma.transactionLabel.findMany({
    where: { userId },
    distinct: ['label'],
    select: { label: true },
    orderBy: { label: 'asc' }
  })
  return NextResponse.json(
    {
      tags: saved.map(tag => tag.label)
    },
    {
      headers: { 'Cache-Control': 'private, no-store' }
    }
  )
})
