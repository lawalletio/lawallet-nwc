import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { swapIdParam, swapPaidSchema } from '@/lib/validation/schemas'
import { markSwapPaid, toSwapDto } from '@/lib/integrations/swaps'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/wallet/swaps/[id]/paid — the client paid the order's invoice and
 * proves it with the preimage. Lets status tracking tell "awaiting payment"
 * from "transfer in progress".
 */
export const POST = withErrorHandling(async (request: Request, ctx: Ctx) => {
  await checkRequestLimits(request, 'json')
  const { pubkey } = await authenticate(request)
  const { id } = validateParams(await ctx.params, swapIdParam)
  const { preimage } = await validateBody(request, swapPaidSchema)
  const account = await resolveAccountByPubkey(pubkey)
  if (!account) throw new NotFoundError('Swap not found')
  const swap = await prisma.swap.findFirst({
    where: { id, userId: account.id }
  })
  if (!swap) throw new NotFoundError('Swap not found')
  return NextResponse.json(toSwapDto(await markSwapPaid(swap, preimage)))
})
