import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { emailAddressSchema } from '@/lib/validation/schemas'
import { ValidationError } from '@/types/server/errors'
import { unlinkEmailFromAccount } from '@/lib/auth/email-login'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * `DELETE /api/account/emails/:email` — stop `email` signing in to the
 * caller's account. Refused (409) when it's the last way in.
 */
export const DELETE = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ email: string }> }
  ) => {
    await checkRequestLimits(request, 'json')
    const auth = await authenticate(request)
    await rateLimit(request, {
      ...RateLimitPresets.sensitive,
      identifier: 'account-email:' + auth.pubkey
    })
    const account = await resolveAccountByPubkey(auth.pubkey)
    if (!account) throw new NotFoundError('Account not found')

    const parsed = emailAddressSchema.safeParse(
      decodeURIComponent((await params).email)
    )
    if (!parsed.success) throw new ValidationError('Invalid email')

    await unlinkEmailFromAccount(account.id, parsed.data)
    return NextResponse.json({ deleted: true })
  }
)
