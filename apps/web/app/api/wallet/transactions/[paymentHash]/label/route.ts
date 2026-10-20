import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import {
  transactionLabelParam,
  updateTransactionLabelSchema
} from '@/lib/validation/schemas'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ paymentHash: string }> }

export const GET = withErrorHandling(
  async (request: Request, context: Context) => {
    const userId = await requireUserId(request)
    const { paymentHash } = validateParams(
      await context.params,
      transactionLabelParam
    )
    const annotation = await prisma.transactionLabel.findUnique({
      where: { userId_paymentHash: { userId, paymentHash } },
      select: { label: true }
    })

    return NextResponse.json(
      { label: annotation?.label ?? null },
      {
        headers: { 'Cache-Control': 'private, no-store' }
      }
    )
  }
)

export const PUT = withErrorHandling(
  async (request: Request, context: Context) => {
    await checkRequestLimits(request, 'json')
    const userId = await requireUserId(request)
    const { paymentHash } = validateParams(
      await context.params,
      transactionLabelParam
    )
    const { label } = await validateBody(request, updateTransactionLabelSchema)

    if (label) {
      await prisma.transactionLabel.upsert({
        where: { userId_paymentHash: { userId, paymentHash } },
        create: { userId, paymentHash, label },
        update: { label }
      })
    } else {
      await prisma.transactionLabel.deleteMany({
        where: { userId, paymentHash }
      })
    }

    return NextResponse.json(
      { label: label || null },
      {
        headers: { 'Cache-Control': 'private, no-store' }
      }
    )
  }
)
