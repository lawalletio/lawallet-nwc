import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { idParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { NotFoundError } from '@/types/server/errors'
import { resolveAddressDomain } from '@/lib/public-url'
import { driverForWallet } from '@/lib/wallet/drivers'
import {
  getAddresslessNwcWalletForUser,
  getPrimaryRemoteWalletForUser
} from '@/lib/wallet/primary-wallet'
import { logger } from '@/lib/logger'
import { recordWalletBalance } from '@/lib/wallet/last-balance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** A POS screen waits on this; an unreachable wallet must not stall it. */
const BALANCE_TIMEOUT_MS = 5000

async function readPrimaryBalance(userId: string): Promise<number | null> {
  const hasAddress = await prisma.lightningAddress.count({
    where: { userId, isPrimary: true }
  })
  const wallet = hasAddress
    ? await getPrimaryRemoteWalletForUser(userId)
    : await getAddresslessNwcWalletForUser(userId)
  if (!wallet || wallet.status === 'REVOKED' || wallet.status === 'DEAD') {
    return null
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const { driver, config } = driverForWallet({
      id: wallet.id,
      type: wallet.type,
      config: wallet.config
    })
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), BALANCE_TIMEOUT_MS)
    })
    const result = await Promise.race([driver.getBalance(config), timeout])
    if (result) await recordWalletBalance(wallet.id, result.balanceSats)
    return result?.balanceSats ?? null
  } catch (err) {
    // Relay down, revoked NWC grant, corrupt config: the operator sees
    // "balance unavailable", never an error screen.
    logger.warn(
      { userId, walletId: wallet.id, err: String(err) },
      'Card owner balance unavailable'
    )
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * `GET /api/cards/[id]/owner` — who holds a card, for the card-manager POS.
 *
 * Operator-scoped (`CARDS_READ`). Shows the holder's lightning addresses
 * (rendered on the LUD-16 domain, not the API host), their live balance, and
 * whether the holder allows card-based account recovery — everything the
 * operator must see before printing a RECOVER QR. `balanceSats` is null when
 * the holder's wallet can't be reached within a few seconds.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await authenticateWithPermission(request, Permission.CARDS_READ)
    await rateLimit(request)
    const { id } = validateParams(await params, idParam)

    const card = await prisma.card.findUnique({
      where: { id },
      select: {
        disabledAt: true,
        user: {
          select: {
            id: true,
            pubkey: true,
            cardRecoveryEnabled: true,
            lightningAddresses: {
              select: { username: true, isPrimary: true },
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
            },
            _count: {
              select: {
                cards: true,
                remoteWallets: {
                  where: { status: { notIn: ['REVOKED', 'DEAD'] } }
                }
              }
            }
          }
        }
      }
    })
    if (!card) throw new NotFoundError('Card not found')

    const owner = card.user
    if (!owner) {
      return NextResponse.json({
        owned: false,
        cardDisabled: !!card.disabledAt
      })
    }

    const [domain, balanceSats] = await Promise.all([
      resolveAddressDomain(request),
      readPrimaryBalance(owner.id)
    ])
    const addresses = owner.lightningAddresses.map(
      a => `${a.username}@${domain}`
    )
    const primary = owner.lightningAddresses.find(a => a.isPrimary)

    return NextResponse.json({
      owned: true,
      pubkey: owner.pubkey,
      primaryAddress: primary ? `${primary.username}@${domain}` : null,
      lightningAddresses: addresses,
      cards: owner._count.cards,
      remoteWallets: owner._count.remoteWallets,
      cardRecoveryEnabled: owner.cardRecoveryEnabled,
      cardDisabled: !!card.disabledAt,
      balanceSats
    })
  }
)
