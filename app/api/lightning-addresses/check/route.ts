import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { ValidationError } from '@/types/server/errors'

export const dynamic = 'force-dynamic'

/**
 * GET /api/lightning-addresses/check?username=satoshi
 *
 * Public endpoint — no auth required.
 * Returns { available: boolean } for the given username.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const username = request.nextUrl.searchParams.get('username')

  if (!username) {
    throw new ValidationError('username query parameter is required')
  }

  const cleaned = username.toLowerCase().trim()

  if (!/^[a-z0-9]+$/.test(cleaned) || cleaned.length < 1 || cleaned.length > 16) {
    throw new ValidationError('Username must be 1-16 lowercase alphanumeric characters')
  }

  const existing = await prisma.lightningAddress.findFirst({
    where: { username: cleaned },
    select: { username: true },
  })

  return NextResponse.json({ available: !existing, username: cleaned })
})
