import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { CardDesign } from '@/types/card-design'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const design = await prisma.cardDesign.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      imageUrl: true,
      description: true,
      createdAt: true
    }
  })

  if (!design) {
    return new NextResponse('Not found', { status: 404 })
  }

  return NextResponse.json(design as CardDesign)
}
