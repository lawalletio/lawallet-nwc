import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { validateParams } from '@/lib/validation/middleware'
import { swapIdParam } from '@/lib/validation/schemas'
import { refreshSwap, toSwapDto } from '@/lib/integrations/swaps'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/wallet/swaps/[id] — one of the caller's cash-outs, with its
 * status refreshed from the provider while pending. Another user's swap is
 * reported as missing, not forbidden.
 */
export const GET = withErrorHandling(async (request: Request, ctx: Ctx) => {
  const { pubkey } = await authenticate(request)
  const { id } = validateParams(await ctx.params, swapIdParam)
  const account = await resolveAccountByPubkey(pubkey)
  if (!account) throw new NotFoundError('Swap not found')
  const swap = await prisma.swap.findFirst({
    where: { id, userId: account.id }
  })
  if (!swap) throw new NotFoundError('Swap not found')
  return NextResponse.json(toSwapDto(await refreshSwap(swap)))
})
