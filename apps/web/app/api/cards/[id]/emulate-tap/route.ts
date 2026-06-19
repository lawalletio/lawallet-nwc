import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signNtag424Tap } from '@/lib/ntag424'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { NotFoundError, ValidationError } from '@/types/server/errors'
import { idParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'

/**
 * `POST /api/cards/[id]/emulate-tap` — server-side SUN signing for the admin
 * card emulator.
 *
 * Signs the card's *next* tap (counter + 1) and returns only the public `p`/`c`
 * URL params — the NTAG424 keys never leave the server. The emulator replays
 * the returned params through the normal `/scan` flow; that flow (not this
 * route) advances the stored counter when the SUN verifies.
 *
 * Gated to `CARDS_WRITE` to match the admin-only emulator. It exports no keys,
 * so it does NOT unpair the card.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    await authenticateWithPermission(request, Permission.CARDS_WRITE)
    const { id } = validateParams(await params, idParam)

    const card = await prisma.card.findUnique({
      where: { id },
      select: {
        ntag424: { select: { cid: true, k1: true, k2: true, ctr: true } }
      }
    })

    if (!card) {
      throw new NotFoundError('Card not found')
    }
    if (!card.ntag424) {
      throw new ValidationError('Card does not have NTAG424 data')
    }

    const ctr = card.ntag424.ctr + 1
    const { p, c } = await signNtag424Tap(card.ntag424, ctr)

    return NextResponse.json({ p, c, ctr })
  }
)
