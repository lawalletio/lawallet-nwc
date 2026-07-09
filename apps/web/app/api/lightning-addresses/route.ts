import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { deriveEffectiveNwcMode } from '@/lib/wallet/wallet-address-dto'
import { derivePrimaryWallet } from '@/lib/wallet/primary-wallet'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/lightning-addresses
 *
 * Global admin list (gated by ADDRESSES_READ): one row per LightningAddress
 * across all users. Each row carries the per-address fields plus the
 * effective `nwcMode` (derived from the bound or default RemoteWallet) so
 * the admin UI doesn't have to re-derive it.
 */
export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.ADDRESSES_READ)

  const addresses = await prisma.lightningAddress.findMany({
    include: {
      remoteWallet: true,
      user: {
        select: {
          pubkey: true,
          // Pull each owner's primary address so DEFAULT_NWC rows can resolve
          // through the wallet linked to that address without N+1 queries.
          lightningAddresses: {
            where: { isPrimary: true },
            take: 1,
            include: { remoteWallet: true },
          },
        },
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
  })

  const transformed = addresses.map(address => ({
    username: address.username,
    pubkey: address.user.pubkey,
    mode: address.mode,
    redirect: address.redirect,
    remoteWalletId: address.remoteWalletId,
    isPrimary: address.isPrimary,
    nwcMode: deriveEffectiveNwcMode(
      address,
      derivePrimaryWallet(address.user.lightningAddresses?.[0]),
    ),
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  }))

  return NextResponse.json(transformed)
})
