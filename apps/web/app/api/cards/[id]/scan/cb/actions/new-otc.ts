import { resolvePublicEndpoint } from '@/lib/public-url'
import { Card } from '@/types'
import { User } from '@/types/user'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export default async function newOTC(
  req: NextRequest,
  card: Card & { user?: User }
) {
  // Generate random 16-byte OTC
  const otc = randomBytes(16).toString('hex')

  // Update the card with the generated OTC
  await prisma.card.update({
    where: { id: card.id },
    data: { otc }
  })

  const { url } = await resolvePublicEndpoint(req)

  logger.info({ cardId: card.id, otc }, 'Generated new OTC for card')

  return NextResponse.json(
    {
      otc,
      url: `${url}/wallet/activate/${otc}/`
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, LAWALLET_ACTION'
      }
    }
  )
}
