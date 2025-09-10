import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { CardDesign } from '@/types/card-design'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
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
