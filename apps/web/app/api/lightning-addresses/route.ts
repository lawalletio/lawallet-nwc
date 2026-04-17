import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { deriveEffectiveNwcMode } from '@/lib/wallet/wallet-address-dto'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/lightning-addresses
 *
 * Global admin list (gated by ADDRESSES_READ): one row per LightningAddress
 * across all users. Each row carries the per-address fields introduced by
 * the addresses_nwc_connection migration plus the effective `nwcMode` so the
 * admin UI doesn't have to re-derive it.
 *
 * `nwcString` is preserved for backward compatibility with older callers.
 */
export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.ADDRESSES_READ)

  const addresses = await prisma.lightningAddress.findMany({
    include: {
      nwcConnection: true,
      user: {
        select: {
          pubkey: true,
          nwc: true,
          // Pull each owner's primary NWC connection so DEFAULT_NWC rows can
          // resolve their effective mode without N+1 queries.
          nwcConnections: { where: { isPrimary: true }, take: 1 },
        },
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
  })

  const transformed = addresses.map(address => ({
    username: address.username,
    pubkey: address.user.pubkey,
    nwcString: address.user.nwc || null,
    mode: address.mode,
    redirect: address.redirect,
    nwcConnectionId: address.nwcConnectionId,
    isPrimary: address.isPrimary,
    nwcMode: deriveEffectiveNwcMode(address, address.user.nwcConnections[0] ?? null),
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  }))

  return NextResponse.json(transformed)
})
