import { NextRequest, NextResponse } from 'next/server'
import { LUD06CallbackSuccess } from '@/types/lnurl'
import { LN, SATS } from '@getalby/sdk'

const NWC_URI = process.env.NWC_URI_EXAMPLE

export async function GET(
  req: NextRequest,
  { params }: { params: { username: string } }
) {
  const { username } = params
  const { searchParams } = new URL(req.url)
  const amount = searchParams.get('amount')

  if (!amount) {
    return NextResponse.json(
      { status: 'ERROR', reason: 'Missing amount' },
      { status: 400 }
    )
  }

  const ln = new LN(NWC_URI!)

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
}
