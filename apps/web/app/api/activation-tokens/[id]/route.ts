import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { idParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { effectiveTokenStatus } from '@/lib/card-activation'

/**
 * `GET /api/activation-tokens/[id]` — public, rate-limited preview for the
 * wallet scanner. Returns enough to render a confirmation card (design + kind)
 * before the claimer authenticates, but no secrets (no NTAG keys, no holder
 * identity). Expired/claimed/revoked state is surfaced via `status` so the
 * wallet can show "already claimed" / "expired" without attempting a claim.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await rateLimit(request)
    const { id } = validateParams(await params, idParam)

    const token = await prisma.cardActivationToken.findUnique({
      where: { id },
      select: {
        id: true,
        qrKind: true,
        status: true,
        expiresAt: true,
        card: {
          select: {
            id: true,
            title: true,
            kind: true,
            design: {
              select: { id: true, imageUrl: true, description: true },
            },
          },
        },
      },
    })
    if (!token) throw new NotFoundError('Activation token not found')

    return NextResponse.json({
      tokenId: token.id,
      qrKind: token.qrKind,
      status: effectiveTokenStatus(token),
      card: {
        id: token.card.id,
        title: token.card.title ?? undefined,
        kind: token.card.kind,
        design: token.card.design,
      },
    })
  },
)
