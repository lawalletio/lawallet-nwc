import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'
import { validateNip98 } from '@/lib/nip98'

export async function POST(request: Request) {
  try {
    const { pubkey } = await validateNip98(request)
    const { otc } = await request.json()

    if (!pubkey) {
      return NextResponse.json(
        { error: 'Public key is required' },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { pubkey },
      include: {
        lightningAddress: true
      }
    })

    let user
    if (existingUser) {
      user = existingUser
    } else {
      // Create new user
      const userId = randomUUID()
      user = await prisma.user.create({
        data: {
          id: userId,
          pubkey,
          createdAt: new Date()
        },
        include: {
          lightningAddress: true
        }
      })
    }

    // If OTC is provided, try to assign a card to this user
    if (otc) {
      const card = await prisma.card.findFirst({
        where: {
          otc: otc
          // TODO: Unless there is a specific user lock, whoever scans the otc will get the card
          // userId: null // Only assign unassigned cards
        }
      })

      if (card) {
        await prisma.card.update({
          where: { id: card.id },
          data: { userId: user.id }
        })
      }
    }

    return NextResponse.json({
      userId: user.id,
      lightningAddress: user.lightningAddress?.username || null
      //   nwcString: ""
    })
  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
