import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { idParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { resolveAddressDomain } from '@/lib/public-url'
import { getRecoveryCheck, type RecoverySide } from '@/lib/account/recover'

export const dynamic = 'force-dynamic'

/**
 * `GET /api/activation-tokens/[id]/recovery-check` — pre-flight for a RECOVER
 * QR, run by the wallet after sign-in and before claiming:
 * - `sameAccount`: the scanner already owns the card → just open the wallet.
 * - `mergeRequired`: the scanner's account already has data → ask before
 *   merging the recovered account into it.
 * `existing` / `incoming` list what each side holds for that prompt.
 *
 * Read-only. Any authenticated wallet user may call it; a pubkey with no
 * account yet reads as an empty `existing` side. 404 for non-RECOVER tokens.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await rateLimit(request, RateLimitPresets.auth)
    const { pubkey } = await authenticate(request)
    const { id } = validateParams(await params, idParam)

    const claimer = await resolveAccountByPubkey(pubkey)
    const check = await getRecoveryCheck({
      tokenId: id,
      claimerId: claimer?.id ?? null
    })

    const domain = await resolveAddressDomain(request)
    const render = (side: RecoverySide) => ({
      ...side,
      lightningAddresses: side.lightningAddresses.map(u => `${u}@${domain}`)
    })

    return NextResponse.json({
      sameAccount: check.sameAccount,
      mergeRequired: check.mergeRequired,
      existing: render(check.existing),
      incoming: render(check.incoming)
    })
  }
)
