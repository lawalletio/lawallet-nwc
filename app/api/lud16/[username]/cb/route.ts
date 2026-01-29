import { NextRequest, NextResponse } from 'next/server'
import { LUD06CallbackSuccess } from '@/types/lnurl'
import { LN, SATS } from '@getalby/sdk'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  InternalServerError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'

export const GET = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ username: string }> }) => {
    const { username: _username } = await params
    const username = _username.trim().toLowerCase()
    const { searchParams } = new URL(req.url)
    const amount = searchParams.get('amount')

    if (!amount) {
      throw new ValidationError('Missing amount')
    }

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
      throw new NotFoundError('Lightning address not found')
    }

    // If user doesn't have an nwc string, return 404
    if (!lightningAddress.user.nwc) {
      throw new NotFoundError('User not configured for payments')
    }

    const ln = new LN(lightningAddress.user.nwc)

    // Correct usage: amount as first arg, description as second
    const invoiceObj = await ln.requestPayment(SATS(Number(amount) / 1000), {
      description: `Payment to @${username}`
    })

    // The property is likely 'paymentRequest', but could be 'invoice'
    const pr = invoiceObj.invoice || invoiceObj.invoice

    if (!pr) {
      throw new InternalServerError('Failed to generate invoice')
    }

    const response: LUD06CallbackSuccess = {
      pr: pr.paymentRequest,
      routes: []
    }

    return NextResponse.json(response)
  }
)
