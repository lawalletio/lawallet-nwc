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
 * This is the security boundary of the whole transfer path. A 20402 signature
 * proves integrity, not authenticity: anyone can generate a keypair, sign a
 * flawless voucher for "$500 off at RealShop", and stand up a service that
 * reports it as valid forever. Every signature check would pass, the victim's
 * stash would show the merchant's real name and avatar (the profile cache
 * resolves any pubkey stored on a Voucher row), and the fraud would surface at
 * the till — the worst possible place.
 *
 * Pinning by pubkey and reusing the stored origin closes that, and closes
 * SSRF-via-transfer at the same time, because no attacker-supplied URL is ever
 * dialled. The cost is real and intended: a coupon from a service this
 * instance has never seen cannot arrive by transfer. Deposit it over the
 * NIP-98 endpoint first — that path has an authenticated signer to hold
 * responsible, which is exactly what transfer lacks.
 *
 * A prior row also supplies the presentation fields, so a sender cannot choose
 * the name, description, or artwork that the recipient will see.
 */
export async function resolveTransferService(input: {
  servicePubkey: string
  userId: string
}): Promise<TransferService | null> {
  // Prefer a row this recipient already holds; fall back to any row on the
  // instance, so a first transfer to a *new member* from a service the
  // community already uses still works.
  const known =
    (await prisma.voucher.findFirst({
      where: {
        servicePubkey: input.servicePubkey,
        userId: input.userId,
        refreshUrl: { not: null }
      },
      orderBy: { createdAt: 'desc' }
    })) ??
    (await prisma.voucher.findFirst({
      where: { servicePubkey: input.servicePubkey, refreshUrl: { not: null } },
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
