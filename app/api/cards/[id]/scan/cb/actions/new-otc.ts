import { getSettings } from '@/lib/settings'
import { Card } from '@/types'
import { User } from '@/types/user'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

export default async function newOTC(
  _req: NextRequest,
  card: Card & { user?: User }
) {
  // Generate random 16-byte OTC
  const otc = randomBytes(16).toString('hex')

  // Update the card with the generated OTC
  await prisma.card.update({
    where: { id: card.id },
    data: { otc }
  })

  const { endpoint } = await getSettings(['endpoint'])

  console.info('--------------------------------')
  console.info('otc', otc)
  console.info('url', `${endpoint}/wallet/activate/${otc}/`)
  console.info('--------------------------------')

  return NextResponse.json(
    {
      otc,
      url: `${endpoint}/wallet/activate/${otc}/`
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, LAWALLET_ACTION'
      }
    }
  )
}
