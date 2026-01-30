// import 'websocket-polyfill'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { LUD03CallbackSuccess } from '@/types/lnurl'
import { LN } from '@getalby/sdk'
import { consumeNtag424FromPC } from '@/lib/ntag424'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, ValidationError } from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { scanCardQuerySchema } from '@/lib/validation/schemas'
import { validateQuery } from '@/lib/validation/middleware'

// NWC URI will be fetched from the user record

export const OPTIONS = withErrorHandling(async () => {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, LAWALLET_ACTION'
    }
  })
})

export const GET = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id: cardId } = await params

  // Get query parameters
  const { p, c } = validateQuery(req.url, scanCardQuerySchema)
  const action = req.headers.get('LAWALLET_ACTION') || 'pay'

  logger.info({ cardId, action }, 'Card scan callback request')

  // Find card by id in database
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: {
      ntag424: true,
      user: true
    }
  })

  if (!card) {
    throw new NotFoundError('Card not found')
  }

  const ntag424Response = await consumeNtag424FromPC(card!.ntag424!, p, c)

  if ('error' in ntag424Response) {
    throw new ValidationError(ntag424Response.error)
  }

  // Update lastUsedAt timestamp and ntag.ctr
  await prisma.card.update({
    where: { id: cardId },
    data: {
      lastUsedAt: new Date(),
      ntag424: {
        update: {
          ctr: ntag424Response.ctrNew
        }
      }
    }
  })

  return (await import(`./actions/${action}`)).default(req, card)
  },
  { headers: { 'Access-Control-Allow-Origin': '*' } }
)
