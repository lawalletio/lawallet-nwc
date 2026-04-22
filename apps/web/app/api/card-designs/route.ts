import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { createCardDesignSchema } from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/card-designs
 *
 * Create a new community-scoped card design. Gated by CARD_DESIGNS_WRITE so
 * both NIP-98 and JWT admins can reach it. The image itself is expected to
 * have been uploaded separately (e.g. Blossom) and the caller passes only
 * the resulting URL plus a human-readable description.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticateWithPermission(
    request,
    Permission.CARD_DESIGNS_WRITE,
  )

  const { description, imageUrl } = await validateBody(
    request,
    createCardDesignSchema,
  )

  // Resolve the caller's user record so the design is attributed. When the
  // authenticated pubkey isn't mapped to a user (shouldn't happen for an
  // ADMIN, but guard anyway), we leave `userId` null — the column is
  // optional for global/community designs.
  const user = await prisma.user.findUnique({
    where: { pubkey: auth.pubkey },
    select: { id: true },
  })

  const design = await prisma.cardDesign.create({
    data: {
      imageUrl,
      description,
      userId: user?.id ?? null,
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

  return NextResponse.json(design)
})
