import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { idParam, updateCardDesignSchema } from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * PATCH /api/card-designs/[id]
 *
 * Partial update of a card design. Currently drives the inline rename on
 * /admin/cards but the schema also accepts a new imageUrl so a future
 * "replace image" affordance can reuse the same endpoint.
 */
// Exposed as PUT because the shared `useMutation` client only knows
// 'post' | 'put' | 'del'. Semantics are still "partial update": the
// handler merges the provided fields only. Adding a real PATCH verb
// across the whole client surface wasn't worth the churn for one route.
export const PUT = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    await checkRequestLimits(request, 'json')
    await authenticateWithPermission(request, Permission.CARD_DESIGNS_WRITE)

    const { id } = validateParams(await params, idParam)
    const { description, imageUrl, archived } = await validateBody(
      request,
      updateCardDesignSchema,
    )

    const existing = await prisma.cardDesign.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!existing) {
      throw new NotFoundError('Design not found')
    }

    const updated = await prisma.cardDesign.update({
      where: { id },
      data: {
        ...(description !== undefined ? { description } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        // Translate the boolean wire format to a timestamp: setting to
        // `true` stamps "archived now", `false` clears it back to active.
        ...(archived !== undefined
          ? { archivedAt: archived ? new Date() : null }
          : {}),
      },
      select: {
        id: true,
        imageUrl: true,
        description: true,
        createdAt: true,
        archivedAt: true,
      },
    })

    eventBus.emit({ type: 'designs:updated', timestamp: Date.now() })

    return NextResponse.json(updated)
  },
)
