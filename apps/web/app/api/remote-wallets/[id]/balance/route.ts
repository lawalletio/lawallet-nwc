import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, ServiceUnavailableError } from '@/types/server/errors'
import { idParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { DriverError, driverForWallet } from '@/lib/wallet/drivers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * `GET /api/remote-wallets/[id]/balance` — live spendable balance for one
 * of the caller's wallets, read through the wallet's driver.
 *
 * Split out from the list endpoint deliberately: `getBalance` is a relay
 * round-trip (≈1s for NWC), so fetching it per-row lets the UI render the
 * table immediately and fill balances in asynchronously, each with its own
 * loading state — rather than blocking the whole list on N sequential
 * round-trips.
 *
 * Ownership-scoped: 404 (not 403) when the wallet belongs to someone else,
 * so IDs can't be enumerated. A REVOKED wallet has no live balance — we
 * 404 it rather than dial a dead connection.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await authenticate(request)
    const user = await resolveAccountByPubkey(auth.pubkey)
    if (!user) throw new NotFoundError('User not found')

    const { id } = validateParams(await params, idParam)

    const wallet = await prisma.remoteWallet.findUnique({ where: { id } })
    if (!wallet || wallet.userId !== user.id || wallet.status === 'REVOKED') {
      throw new NotFoundError('Wallet not found')
    }

    try {
      const { driver, config } = driverForWallet({ type: wallet.type, config: wallet.config })
      const { balanceSats } = await driver.getBalance(config)
      return NextResponse.json({ balanceSats })
    } catch (err) {
      // The wallet exists but its backing connection is unreachable (relay
      // down, revoked NWC grant, corrupt config). Surface as 503 so the UI
      // can show "unavailable" without treating it as a hard error.
      if (err instanceof DriverError) {
        throw new ServiceUnavailableError('Wallet balance is currently unavailable')
      }
      throw err
    }
  },
)
