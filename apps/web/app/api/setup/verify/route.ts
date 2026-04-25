import { NextResponse } from 'next/server'
import { issueVerifyToken, getVerifyToken } from '@/lib/setup/verify-token'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'cache-control': 'no-store',
}

export async function POST() {
  const token = issueVerifyToken()
  return NextResponse.json({ token }, { headers: CORS_HEADERS })
}

export async function GET() {
  const token = getVerifyToken()
  if (!token) {
    return new NextResponse('', { status: 404, headers: { ...CORS_HEADERS, 'content-type': 'text/plain' } })
  }
  return new NextResponse(token, {
    status: 200,
    headers: { ...CORS_HEADERS, 'content-type': 'text/plain' },
  })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
