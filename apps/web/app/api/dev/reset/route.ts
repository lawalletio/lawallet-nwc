import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { logger } from '@/lib/logger'

// Wipes the entire database back to a clean state so the onboarding
// flow can be re-tested. Dev-only: 404 in production so the route is
// not even discoverable. No auth — auth state itself is being wiped.
export const POST = withErrorHandling(async () => {
  if (process.env.NODE_ENV === 'production') {
    throw new NotFoundError('Not found')
  }

  // Delete leaf rows first to respect FK constraints. Most relations
  // have onDelete: Cascade or SetNull so this ordering is conservative
  // rather than strictly required.
  await prisma.$transaction([
    prisma.activityLog.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.card.deleteMany(),
    prisma.ntag424.deleteMany(),
    prisma.lightningAddress.deleteMany(),
    prisma.nWCConnection.deleteMany(),
    prisma.cardDesign.deleteMany(),
    prisma.albySubAccount.deleteMany(),
    prisma.user.deleteMany(),
    prisma.settings.deleteMany(),
  ])

  logger.warn('[dev] Database wiped via /api/dev/reset')
  return NextResponse.json({ ok: true })
})
