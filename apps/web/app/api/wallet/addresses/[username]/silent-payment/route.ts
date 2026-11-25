import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthenticationError, NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import {
  setSilentPaymentSchema,
  walletAddressUsernameParam
} from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import {
  parseSilentPaymentAddress,
  publishSilentPayment,
  unpublishSilentPayment
} from '@/lib/silent-payments'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ username: string }> }

/** Owner-only: same 404 for "missing" and "not yours". */
async function ownedAddress(request: Request, ctx: Ctx) {
  await rateLimit(request, RateLimitPresets.sensitive)
  const { pubkey } = await authenticate(request)
  const { username } = validateParams(
    await ctx.params,
    walletAddressUsernameParam
  )
  const user = await resolveAccountByPubkey(pubkey)
  if (!user) throw new AuthenticationError('User not found')
  const address = await prisma.lightningAddress.findUnique({
    where: { username },
    select: { username: true, userId: true, silentPaymentAddress: true }
  })
  if (!address || address.userId !== user.id) {
    throw new NotFoundError('Address not found')
  }
  return address
}

function announce(username: string, userId: string, sp: string | null) {
  eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
  logActivity.fireAndForget({
    category: 'ADDRESS',
    event: ActivityEvent.ADDRESS_UPDATED,
    message: sp
      ? `Silent payment address published for ${username}`
      : `Silent payment address removed from ${username}`,
    userId,
    metadata: { username, silentPaymentAddress: sp }
  })
}

/**
 * PUT /api/wallet/addresses/[username]/silent-payment
 *
 * Sets or replaces the address's BIP-352 silent payment address and publishes
 * the BIP-353 TXT record. DNS is written first: if the provider fails the
 * request fails and the stored value is left unchanged.
 */
export const PUT = withErrorHandling(async (request: Request, ctx: Ctx) => {
  await checkRequestLimits(request, 'json')
  const address = await ownedAddress(request, ctx)
  const body = await validateBody(request, setSilentPaymentSchema)
  const sp = parseSilentPaymentAddress(body.address)

  await publishSilentPayment(address.username, sp)
  await prisma.lightningAddress.update({
    where: { username: address.username },
    data: { silentPaymentAddress: sp }
  })

  announce(address.username, address.userId, sp)
  return NextResponse.json({ username: address.username, silentPaymentAddress: sp })
})

/**
 * DELETE /api/wallet/addresses/[username]/silent-payment
 *
 * Removes the TXT record, then clears the stored address.
 */
export const DELETE = withErrorHandling(async (request: Request, ctx: Ctx) => {
  const address = await ownedAddress(request, ctx)
  if (address.silentPaymentAddress) {
    await unpublishSilentPayment(address.username)
    await prisma.lightningAddress.update({
      where: { username: address.username },
      data: { silentPaymentAddress: null }
    })
    announce(address.username, address.userId, null)
  }
  return NextResponse.json({
    username: address.username,
    silentPaymentAddress: null
  })
})
