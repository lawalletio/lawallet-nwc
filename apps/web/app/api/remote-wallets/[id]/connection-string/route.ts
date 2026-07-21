import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, ValidationError } from '@/types/server/errors'
import { idParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * `GET /api/remote-wallets/[id]/connection-string`
 *
 * Returns the wallet's NWC connection URI so the client can mint
 * invoices / send payments directly against the relay (same pattern the
 * existing wallet receive flow uses with `me.effectiveNwcString`, only
 * scoped to a specific wallet instead of the user's default).
 *
 * Ownership-scoped: 404 (not 403) when the wallet belongs to someone
 * else, so wallet IDs can't be enumerated. REVOKED wallets 404 too —
 * there's no live connection to hand out.
 *
 * Only NWC wallets are supported today; LND / CLN / BTCPAY would need
 * their own per-driver "give me a client-usable handle" output (HTTP
 * URL + macaroon, etc.) which isn't shaped yet. We 400 those types
 * rather than silently returning nothing.
 *
 * The connection string is a SECRET — only the owner of the wallet
 * can fetch it, and the response is `force-dynamic` so it never
 * touches a CDN cache.
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

    if (wallet.type !== 'NWC') {
      throw new ValidationError(
        `Connection strings are not exposed for ${wallet.type} wallets yet`,
      )
    }

    // `wallet.config` is JSON (Prisma type `JsonValue`) — narrow it just
    // enough to read the field. The strict shape is enforced upstream by
    // `nwcConfigSchema` in nwc-driver.ts on write, so we can trust the
    // type at read time.
    const config = wallet.config as { connectionString?: string } | null
    const connectionString = config?.connectionString ?? null

    if (!connectionString) {
      // The wallet is marked NWC but has no URI — shouldn't happen, but
      // surface it as a server-side data integrity issue rather than a
      // bare 200 with a null secret the client can't act on.
      throw new NotFoundError('Connection string not configured')
    }

    return NextResponse.json({ connectionString })
  },
)
