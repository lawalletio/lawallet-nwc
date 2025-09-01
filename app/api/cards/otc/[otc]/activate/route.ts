import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'
import { validateNip98 } from '@/lib/nip98'
import { AlbyHub } from '@/lib/albyhub'

const ALBY_API_URL = process.env.ALBY_API_URL!
const ALBY_BEARER_TOKEN = process.env.ALBY_BEARER_TOKEN!
const AUTO_GENERATE_ALBY_SUBACCOUNTS =
  process.env.AUTO_GENERATE_ALBY_SUBACCOUNTS === 'true'

export async function POST(
  request: Request,
  { params }: { params: { otc: string } }
) {
  try {
    const { pubkey } = await validateNip98(request)
    const { otc } = params

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
        lightningAddress: true,
        albySubAccount: true
      }
    })

    let user
    if (existingUser) {
      user = existingUser
    } else {
      // Create new user
      const userId = randomUUID()

      const albyHub = new AlbyHub(ALBY_API_URL, ALBY_BEARER_TOKEN)

      const subAccount = AUTO_GENERATE_ALBY_SUBACCOUNTS
        ? await albyHub.createSubAccount(`LaWallet-${userId}`)
        : null

      user = await prisma.user.create({
        data: {
          id: userId,
          pubkey,
          createdAt: new Date(),
          albyEnabled: !!subAccount,
          albySubAccount: subAccount
            ? {
                create: {
                  appId: subAccount.id,
                  nwcUri: subAccount.pairingUri,
                  username: subAccount.lud16,
                  nostrPubkey: subAccount.walletPubkey
                }
              }
            : undefined
        },
        include: {
          lightningAddress: true,
          albySubAccount: true
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
      lightningAddress: user.lightningAddress?.username || null,
      albySubAccount: user.albySubAccount
        ? {
            appId: user.albySubAccount.appId,
            nwcUri: user.albySubAccount.nwcUri,
            username: user.albySubAccount.username
          }
        : null,
      nwcString: user.albySubAccount ? user.albySubAccount.nwcUri : ''
    })
  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
