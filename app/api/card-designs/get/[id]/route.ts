import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { CardDesign } from '@/types/card-design'
import { validateAdminAuth } from '@/lib/admin-auth'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    await validateAdminAuth(request)
  } catch (response) {
    if (response instanceof NextResponse) {
      return response
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
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
