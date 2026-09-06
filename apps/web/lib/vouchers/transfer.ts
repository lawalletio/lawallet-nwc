import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/lib/generated/prisma'

/**
 * Everything needed to take delivery of a coupon from a given service, drawn
 * entirely from rows we already hold.
 */
export interface TransferService {
  claimUrl: string
  refreshUrl: string
  mintUrl: string | null
  name: string
  description: string | null
  imageUrl: string | null
  metadata: Prisma.InputJsonValue | null
  expiresAt: Date | null
}

/**
 * Resolve the coupon-manager service that signed an incoming transfer — from
 * **our own records**, never from the request.
 *
 * This is the security boundary of the whole transfer path, and it has to
 * clear a higher bar than "we have seen this pubkey before".
 *
 * A 20402 signature proves integrity, not authenticity: anyone can generate a
 * keypair, sign a flawless voucher for "$500 off at RealShop", and stand up a
 * service that reports it valid forever. Worse, a coupon is a bearer token —
 * so an attacker can *legitimately obtain* one genuine voucher signed by a
 * real CMS and deposit it here with `refreshUrl` pointing at themselves. If
 * any stored row could establish a service's endpoint, that one relayed
 * deposit would redirect the next inbound transfer's bearer nonce straight to
 * the attacker.
 *
 * So the endpoint is only trusted from a row the service **authenticated
 * itself** to write: `depositedBy` is the NIP-98 signer of the deposit, and
 * requiring it to equal `servicePubkey` means the CMS proved possession of
 * its own key in the same request that supplied the URLs. A relayer cannot
 * forge that without the service's key, which is the trust ceremony this
 * needs and the reason no separate registry is required.
 *
 * Consequences worth knowing:
 *   - A service that only ever mints through third-party minters must
 *     self-deposit at least once before its coupons can be transferred.
 *   - A coupon from a service this instance has never seen cannot arrive by
 *     transfer at all. That is the correct answer, not a gap.
 *
 * A prior row also supplies presentation fields, but only as a fallback: the
 * refresh response is mint-shaped and describes the actual replacement, so
 * `cb/actions/voucher.ts` prefers it and only falls back here when the
 * service says nothing. A fallback can therefore surface a sibling coupon's
 * name — acceptable, since the alternative is letting the sender choose it.
 */
export async function resolveTransferService(input: {
  servicePubkey: string
  userId: string
}): Promise<TransferService | null> {
  // Self-deposited rows only. Prefer one this recipient already holds, then
  // any on the instance — both are equally authenticated, so the preference
  // is about picking the freshest relevant copy, not about trust.
  const where = {
    servicePubkey: input.servicePubkey,
    // The service signed the deposit that carried these URLs.
    depositedBy: input.servicePubkey,
    refreshUrl: { not: null }
  } as const

  const known =
    (await prisma.voucher.findFirst({
      where: { ...where, userId: input.userId },
      orderBy: { createdAt: 'desc' }
    })) ??
    (await prisma.voucher.findFirst({
      where,
      orderBy: { createdAt: 'desc' }
    }))

  if (!known?.refreshUrl) return null

  return {
    claimUrl: known.claimUrl,
    refreshUrl: known.refreshUrl,
    mintUrl: known.mintUrl,
    name: known.name,
    description: known.description,
    imageUrl: known.imageUrl,
    metadata: (known.metadata ?? null) as Prisma.InputJsonValue | null,
    expiresAt: known.expiresAt
  }
}
