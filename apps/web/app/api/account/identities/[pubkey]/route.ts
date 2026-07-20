import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { prisma } from '@/lib/prisma'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import {
  hexPubkeySchema,
  updateIdentityRequestSchema
} from '@/lib/validation/schemas'
import { z } from 'zod'
import { setPrimaryIdentity, unlinkIdentity } from '@/lib/account/merge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const paramsSchema = z.object({ pubkey: hexPubkeySchema })

/**
 * Owner-scoped identity lookup. 404 (never 403) when the identity doesn't
 * exist OR belongs to someone else — same anti-enumeration idiom as the
 * passkey credential routes.
 */
async function requireOwnIdentity(
  request: Request,
  rawParams: Record<string, string>
) {
  const auth = await authenticate(request)
  const account = await resolveAccountByPubkey(auth.pubkey)
  if (!account) throw new NotFoundError('Identity not found')

  const { pubkey } = validateParams(rawParams, paramsSchema)
  const identity = await prisma.nostrIdentity.findUnique({ where: { pubkey } })
  if (!identity || identity.userId !== account.id) {
    throw new NotFoundError('Identity not found')
  }
  return { auth, account, identity }
}

/**
 * `PATCH /api/account/identities/[pubkey]` — rename an identity's label or
 * promote it to primary (`{ isPrimary: true }`). Promoting mirrors the new
 * primary onto `User.pubkey`; the caller should refresh its session token
 * afterwards so the JWT presents the new primary.
 */
export const PATCH = withErrorHandling(
  async (request: Request, context: { params: Promise<{ pubkey: string }> }) => {
    await checkRequestLimits(request, 'json')
    const { auth, account, identity } = await requireOwnIdentity(
      request,
      await context.params
    )
    await rateLimit(request, {
      ...RateLimitPresets.sensitive,
      identifier: 'account-identity:' + auth.pubkey
    })

    const body = await validateBody(request, updateIdentityRequestSchema)

    if (body.label !== undefined) {
      await prisma.nostrIdentity.update({
        where: { pubkey: identity.pubkey },
        data: { label: body.label }
      })
    }
    if (body.isPrimary) {
      await setPrimaryIdentity(account.id, identity.pubkey)
    }

    const updated = await prisma.nostrIdentity.findUnique({
      where: { pubkey: identity.pubkey }
    })
    return NextResponse.json({
      pubkey: updated!.pubkey,
      isPrimary: updated!.isPrimary,
      label: updated!.label,
      createdAt: updated!.createdAt.toISOString()
    })
  }
)

/**
 * `DELETE /api/account/identities/[pubkey]` — unlink a SECONDARY identity.
 * The primary (409: change primary first) and the last identity (409) are
 * protected in the engine.
 */
export const DELETE = withErrorHandling(
  async (request: Request, context: { params: Promise<{ pubkey: string }> }) => {
    const { auth, account, identity } = await requireOwnIdentity(
      request,
      await context.params
    )
    await rateLimit(request, {
      ...RateLimitPresets.sensitive,
      identifier: 'account-identity:' + auth.pubkey
    })

    await unlinkIdentity(account.id, identity.pubkey)
    return NextResponse.json({ message: 'Identity unlinked', pubkey: identity.pubkey })
  }
)
