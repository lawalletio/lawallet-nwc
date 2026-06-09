import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function GET(request: NextRequest) {
  const probe = request.nextUrl.searchParams.get('probe')?.trim() ?? ''

  return NextResponse.json({
    service: 'lawallet',
    probe,
  })
}
