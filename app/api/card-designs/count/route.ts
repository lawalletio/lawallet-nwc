import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { validateAdminAuth } from '@/lib/admin-auth'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandling(async (request: Request) => {
  await validateAdminAuth(request)
  const count = await prisma.cardDesign.count()
  return NextResponse.json({ count })
})
