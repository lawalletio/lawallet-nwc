import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { CardDesign } from '@/types/card-design'
import { validateAdminAuth } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    await validateAdminAuth(request)
  } catch (response) {
    if (response instanceof NextResponse) {
      return response
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
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
}
