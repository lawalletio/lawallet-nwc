import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { Permission, hasPermission } from '@/lib/auth/permissions'
import { AuthorizationError, NotFoundError } from '@/types/server/errors'
import { toWalletAddressDto } from '@/lib/wallet/wallet-address-dto'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/users/[userId]
 *
 * Returns a single user's core fields, all lightning addresses with their
 * effective NWC mode, and aggregate transaction stats drawn from Invoice.
 *
 * Access model:
 *   - Viewing yourself is always allowed, regardless of USERS_READ, so a
 *     plain USER can load their own profile page (the /admin sidebar
 *     footer links here).
 *   - Viewing someone else requires the USERS_READ permission
 *     (OPERATOR / VIEWER / ADMIN).
 */
export const GET = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ userId: string }> },
  ) => {
    const auth = await authenticate(request)

    const { userId } = await params

    // Accept either the internal UUID id or a 64-char hex pubkey so the
    // sidebar's "go to my profile" shortcut (which only has a pubkey in
    // auth context) can hit this route without a prior id lookup.
    const isHexPubkey = /^[0-9a-f]{64}$/i.test(userId)
    const user = await prisma.user.findUnique({
      where: isHexPubkey ? { pubkey: userId.toLowerCase() } : { id: userId },
      include: {
        lightningAddresses: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
          include: { nwcConnection: true },
        },
        nwcConnections: { where: { isPrimary: true }, take: 1 },
      },
    })

    if (!user) {
      throw new NotFoundError('User not found')
    }

    // Self can always read their own profile; otherwise require USERS_READ.
    // Check post-lookup so callers can't probe for pubkey existence via
    // 403 vs 404.
    const isSelf = user.pubkey === auth.pubkey
    if (!isSelf && !hasPermission(auth.role, Permission.USERS_READ)) {
      throw new AuthorizationError('Not authorized to view this user')
    }

    const primaryNwc = user.nwcConnections[0] ?? null

    const [transactionCount, paidInvoices] = await Promise.all([
      prisma.invoice.count({ where: { userId: user.id } }),
      prisma.invoice.aggregate({
        where: { userId: user.id, status: 'PAID' },
        _sum: { amountSats: true },
        _count: true,
      }),
    ])

    return NextResponse.json({
      id: user.id,
      pubkey: user.pubkey,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      addresses: user.lightningAddresses.map(a =>
        toWalletAddressDto(a, primaryNwc),
      ),
      transactions: {
        total: transactionCount,
        paid: paidInvoices._count,
        paidSats: paidInvoices._sum.amountSats ?? 0,
      },
    })
  },
)
