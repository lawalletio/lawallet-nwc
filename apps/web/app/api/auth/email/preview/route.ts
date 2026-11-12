import { NextRequest, NextResponse, after } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import {
  emailLoginTokenSchema,
  type EmailLoginPreviewResponse
} from '@/lib/validation/schemas'
import { resolveProfiles } from '@/lib/nostr/profile-cache'
import {
  assertEmailLoginEnabled,
  findUserByEmail,
  maskEmail,
  peekEmailLoginToken
} from '@/lib/auth/email-login'

/**
 * Landing preview for a magic link: who is about to sign in (avatar, display
 * name) WITHOUT consuming the token, so link scanners can't burn it. The user
 * confirms with a tap, which calls `/verify`.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, RateLimitPresets.auth)
  await assertEmailLoginEnabled()

  const { token } = await validateBody(request, emailLoginTokenSchema)
  const email = await peekEmailLoginToken(token)
  const user = await findUserByEmail(email)

  let displayName: string | null = null
  let picture: string | null = null
  if (user) {
    let [profile] = await resolveProfiles([user.pubkey], {
      schedule: task => after(task)
    }).catch(() => [])
    // A nameless or missing profile may predate the one the user set up after
    // signing up: the cache keeps rows 7 days and backs off after a "not
    // found". Re-fetch from the relays (token-gated, rate-limited) unless the
    // call above just did.
    // ponytail: users who never set a name pay ~3s per preview; cache-bust on
    // the wallet's profile publish if that matters.
    const nameless = !(profile?.displayName || profile?.name)
    if (nameless && Date.now() - (profile?.fetchedAt ?? 0) > 60_000) {
      ;[profile] = await resolveProfiles([user.pubkey], { force: true }).catch(
        () => [profile]
      )
    }
    displayName = profile?.displayName || profile?.name || null
    picture = profile?.picture || null
  }

  return NextResponse.json({
    isNew: !user,
    email: maskEmail(email),
    pubkey: user?.pubkey ?? null,
    displayName,
    picture
  } satisfies EmailLoginPreviewResponse)
})
