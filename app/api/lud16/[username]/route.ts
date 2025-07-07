import { LUD06Response } from '@/types/lnurl'
import { NextRequest, NextResponse } from 'next/server'

const ENDPOINT = process.env.NEXT_PUBLIC_ENDPOINT || 'http://localhost:3000'

export async function GET(
  req: NextRequest,
  { params }: { params: { username: string } }
) {
  const { username } = params
  console.info('LUD16 username:', username)

  // LUD-16 (LNURLp) response
  // See: https://github.com/lnurl/luds/blob/luds/lud-16.md
  // Example response fields
  const domain = req.headers.get('host') || 'localhost:3000'
  const callback = `${ENDPOINT}/api/lud16/${username}/cb`

  return NextResponse.json({
    status: 'OK',
    tag: 'payRequest',
    callback,
    minSendable: 1000, // 1 satoshi in msats
    maxSendable: 1000000000, // 1,000,000 sats in msats
    metadata: JSON.stringify([
      ['text/plain', `Payment to @${username} on ${domain}`]
    ]),
    commentAllowed: 200,
    payerData: {
      name: { mandatory: false },
      email: { mandatory: false }
    }
  } as LUD06Response)
}
