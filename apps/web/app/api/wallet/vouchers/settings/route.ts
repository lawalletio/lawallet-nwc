import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, ValidationError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { validateBody } from '@/lib/validation/middleware'
import { updateVoucherSettingsSchema } from '@/lib/validation/schemas'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { toNpub } from '@/lib/nostr/profile'
import { resolveVoucherSenders } from '@/lib/vouchers/sender'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface VoucherSettingsDto {
  policy: 'ANYONE' | 'ALLOWLIST'
  /** Hex pubkeys, with their npub form so the UI never re-encodes. */
  allowlist: { pubkey: string; npub: string }[]
}

function toDto(row: {
  voucherDepositPolicy: string
  voucherSenderAllowlist: string[]
}): VoucherSettingsDto {
  return {
    policy: row.voucherDepositPolicy as 'ANYONE' | 'ALLOWLIST',
    allowlist: row.voucherSenderAllowlist.map(pubkey => ({
      pubkey,
      npub: toNpub(pubkey)
    }))
  }
}

const SELECT = {
  id: true,
  voucherDepositPolicy: true,
  voucherSenderAllowlist: true
} as const

/** GET /api/wallet/vouchers/settings — the caller's own deposit policy. */
export const GET = withErrorHandling(async (request: Request) => {
  const { pubkey } = await authenticate(request)
  const account = await resolveAccountByPubkey(pubkey)
  if (!account) throw new NotFoundError('User not found')

  const user = await prisma.user.findUnique({
    where: { id: account.id },
    select: SELECT
  })
  if (!user) throw new NotFoundError('User not found')

  return NextResponse.json(toDto(user))
})

/**
 * PUT /api/wallet/vouchers/settings
 *
 * Set who may deposit vouchers to this account. Allowlist entries may be hex,
 * npub, or NIP-05, and are resolved to hex here so the deposit path stays a
 * plain membership test.
 *
 * An entry that doesn't resolve fails the whole save rather than being
 * dropped: silently storing a shorter list than the owner typed would leave
 * them believing a sender is allowed when they aren't.
 */
export const PUT = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const { pubkey } = await authenticate(request)
  const account = await resolveAccountByPubkey(pubkey)
  if (!account) throw new NotFoundError('User not found')

  const body = await validateBody(request, updateVoucherSettingsSchema)
  const { pubkeys, unresolved } = await resolveVoucherSenders(body.allowlist)
  if (unresolved.length > 0) {
    throw new ValidationError('Some senders could not be resolved', {
      unresolved
    })
  }

  const user = await prisma.user.update({
    where: { id: account.id },
    data: {
      voucherDepositPolicy: body.policy,
      voucherSenderAllowlist: pubkeys
    },
    select: SELECT
  })

  return NextResponse.json(toDto(user))
})
