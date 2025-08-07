import { NextRequest, NextResponse } from 'next/server'
import { LUD06CallbackSuccess } from '@/types/lnurl'
import { LN, SATS } from '@getalby/sdk'
import { prisma } from '@/lib/prisma'

export async function GET(
  req: NextRequest,
  { params }: { params: { username: string } }
) {
  const _username = params.username
  const username = _username.trim().toLowerCase()
  const { searchParams } = new URL(req.url)
  const amount = searchParams.get('amount')

  if (!amount) {
    return NextResponse.json(
      { status: 'ERROR', reason: 'Missing amount' },
      { status: 400 }
    )
  }

  try {
    // Look for the user with that lightning address
    const lightningAddress = await prisma.lightningAddress.findUnique({
      where: { username },
      include: {
        user: {
          select: {
            id: true,
            nwc: true
          }
        }
      }
    })

    // If not found, return 404
    if (!lightningAddress) {
      return NextResponse.json(
        { status: 'ERROR', reason: 'Lightning address not found' },
        { status: 404 }
      )
    }

    // If user doesn't have an nwc string, return 404
    if (!lightningAddress.user.nwc) {
      return NextResponse.json(
        { status: 'ERROR', reason: 'User not configured for payments' },
        { status: 404 }
      )
    }

    const ln = new LN(lightningAddress.user.nwc)

    // Correct usage: amount as first arg, description as second
    const invoiceObj = await ln.requestPayment(SATS(Number(amount) / 1000), {
      description: `Payment to @${username}`
    })

    // The property is likely 'paymentRequest', but could be 'invoice'
    const pr = invoiceObj.invoice || invoiceObj.invoice

    if (!pr) {
      return NextResponse.json(
        { status: 'ERROR', reason: 'Failed to generate invoice' },
        { status: 500 }
      )
    }

    const response: LUD06CallbackSuccess = {
      pr: pr.paymentRequest,
      routes: []
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error in LUD16 callback route:', error)
    return NextResponse.json(
      { status: 'ERROR', reason: 'Internal server error' },
      { status: 500 }
    )
  }
}
