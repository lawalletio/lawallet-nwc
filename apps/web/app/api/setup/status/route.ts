import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'

// Public, unauthenticated check used by the landing page to decide
// whether to show "Setup now" CTAs (no root assigned yet) or the
// regular Login / Claim flow. Exposes only a boolean — never the
// root pubkey itself.
export const GET = withErrorHandling(async () => {
  const root = await prisma.settings.findUnique({ where: { name: 'root' } })
  return NextResponse.json({ hasRoot: !!root })
})
