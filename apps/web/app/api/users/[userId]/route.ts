import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { NotFoundError } from '@/types/server/errors'
import { toWalletAddressDto } from '@/lib/wallet/wallet-address-dto'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/users/[userId]
 *
 * Admin detail view (gated by USERS_READ) for a single user. Returns the
 * user's core fields, all lightning addresses with their effective NWC
 * mode, and aggregate transaction stats drawn from the Invoice table.
 */
export const GET = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ userId: string }> },
  ) => {
    await authenticateWithPermission(request, Permission.USERS_READ)

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
