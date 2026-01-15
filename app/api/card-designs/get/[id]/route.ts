import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import type { CardDesign } from '@/types/card-design'
import { validateAdminAuth } from '@/lib/admin-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: { id: string } }) => {
    await validateAdminAuth(request)
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
      throw new NotFoundError('Design not found')
    }

    return NextResponse.json(design as CardDesign)
  }
)
