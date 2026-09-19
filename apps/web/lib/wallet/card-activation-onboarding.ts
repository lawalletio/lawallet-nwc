import type { Prisma } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { logger } from '@/lib/logger'
import { createLncurlRemoteWallet } from '@/lib/wallet/lncurl-wallet'
import {
  findInitialPrimaryWalletCandidate,
  getPrimaryRemoteWalletForUser
} from '@/lib/wallet/primary-wallet'
import { driverForWallet } from '@/lib/wallet/drivers'
import { ValidationError } from '@/types/server/errors'

type PrismaLike = typeof prisma | Prisma.TransactionClient

export const CARD_FREE_LN_SETTING = 'card_free_ln_enabled'
export const CARD_SATS_ENABLED_SETTING = 'card_sats_bonus_enabled'
export const CARD_SATS_AMOUNT_SETTING = 'card_sats_bonus_amount'
export const CARD_SATS_WALLET_SETTING = 'card_sats_bonus_wallet_id'

export interface ActivationBonusEligibility {
  freeLightningAddress: boolean
  needsLightningAddress: boolean
  sats: {
    eligible: boolean
    amountSats?: number
    sourceWalletId?: string
  }
}

export interface ClaimBonusesResponse {
  freeLightningAddress: boolean
  sats: { granted: boolean; amountSats?: number }
}

/**
 * Resolve the RemoteWallet that will fund the newly claimed card.
 *
 * Explicit choice wins (must be the claimer's ACTIVE wallet). Otherwise
 * prefer the wallet bound to the primary Lightning Address, then any
 * ACTIVE wallet, then a freshly minted LNCurl wallet. Failures to mint
 * are swallowed so claim still succeeds — the card stays unbound.
 */
export async function resolveClaimWallet(input: {
  userId: string
  explicitWalletId?: string | null
}): Promise<string | null> {
  if (input.explicitWalletId) {
    const wallet = await prisma.remoteWallet.findUnique({
      where: { id: input.explicitWalletId },
      select: { id: true, userId: true, status: true }
    })
    if (
      !wallet ||
      wallet.userId !== input.userId ||
      wallet.status !== 'ACTIVE'
    ) {
      throw new ValidationError('Unknown or inactive wallet')
    }
    return wallet.id
  }

  const primary = await getPrimaryRemoteWalletForUser(input.userId)
  if (primary?.status === 'ACTIVE') return primary.id

  const candidate = await findInitialPrimaryWalletCandidate(input.userId)
  if (candidate) return candidate.id

  try {
    const created = await createLncurlRemoteWallet({ userId: input.userId })
    return created.id
  } catch (err) {
    logger.error(
      { userId: input.userId, err: String(err) },
      'LNCurl auto-create failed during card activation'
    )
    return null
  }
}

/**
 * Decide which first-activation bonuses this claim may reserve.
 *
 * Free Lightning Address (default ON): first claim of this card, user has
 * never reserved/redeemed one, and they do not already own an address.
 *
 * Sats bonus (default OFF): enabled + amount + ACTIVE treasury wallet, and
 * this card has no REDEEMED SATS grant. A leftover RESERVED grant is a
 * retry, not a new bonus.
 */
export async function evaluateActivationBonuses(
  input: { userId: string; cardId: string },
  client: PrismaLike = prisma
): Promise<ActivationBonusEligibility> {
  const settings = await getSettings([
    CARD_FREE_LN_SETTING,
    CARD_SATS_ENABLED_SETTING,
    CARD_SATS_AMOUNT_SETTING,
    CARD_SATS_WALLET_SETTING
  ])

  const existingAddress = await client.lightningAddress.findFirst({
    where: { userId: input.userId },
    select: { username: true }
  })
  const needsLightningAddress = !existingAddress

  const priorClaim = await client.cardActivationToken.findFirst({
    where: { cardId: input.cardId, status: 'CLAIMED' },
    select: { id: true }
  })
  const cardNeverClaimed = !priorClaim

  const userFreeGrant = await client.cardActivationBonus.findFirst({
    where: { userId: input.userId, kind: 'FREE_ADDRESS' },
    select: { id: true }
  })

  const freeEnabled = settings[CARD_FREE_LN_SETTING] !== 'false'
  const freeLightningAddress =
    freeEnabled && cardNeverClaimed && !userFreeGrant && needsLightningAddress

  const satsEnabled = settings[CARD_SATS_ENABLED_SETTING] === 'true'
  const amountSats = Number.parseInt(
    settings[CARD_SATS_AMOUNT_SETTING] ?? '',
    10
  )
  const sourceWalletId = settings[CARD_SATS_WALLET_SETTING]?.trim() || ''

  let satsEligible = false
  if (satsEnabled && amountSats > 0 && sourceWalletId) {
    const existingSats = await client.cardActivationBonus.findUnique({
      where: {
        cardId_kind: { cardId: input.cardId, kind: 'SATS' }
      },
      select: { id: true, status: true }
    })
    if (!existingSats || existingSats.status === 'RESERVED') {
      const treasury = await client.remoteWallet.findUnique({
        where: { id: sourceWalletId },
        select: { id: true, status: true }
      })
      satsEligible = treasury?.status === 'ACTIVE'
    }
  }

  return {
    freeLightningAddress,
    needsLightningAddress,
    sats: {
      eligible: satsEligible,
      amountSats: satsEligible ? amountSats : undefined,
      sourceWalletId: satsEligible ? sourceWalletId : undefined
    }
  }
}

/** Persist reserved grants inside the claim transaction. */
export async function reserveActivationBonuses(
  input: {
    userId: string
    cardId: string
    eligibility: ActivationBonusEligibility
  },
  client: PrismaLike
): Promise<void> {
  if (input.eligibility.freeLightningAddress) {
    await client.cardActivationBonus.create({
      data: {
        cardId: input.cardId,
        userId: input.userId,
        kind: 'FREE_ADDRESS',
        status: 'RESERVED'
      }
    })
  }

  if (input.eligibility.sats.eligible) {
    await client.cardActivationBonus.upsert({
      where: {
        cardId_kind: { cardId: input.cardId, kind: 'SATS' }
      },
      create: {
        cardId: input.cardId,
        userId: input.userId,
        kind: 'SATS',
        status: 'RESERVED',
        amountSats: input.eligibility.sats.amountSats,
        sourceWalletId: input.eligibility.sats.sourceWalletId
      },
      update: {}
    })
  }
}

/**
 * Pay a reserved SATS grant from the admin treasury into `userWalletId`.
 * Success marks the grant REDEEMED. Failure leaves it RESERVED so a later
 * activation of the same card can retry. Never throws — claim must succeed.
 */
export async function deliverReservedSatsBonus(input: {
  cardId: string
  userWalletId: string | null
}): Promise<{ granted: boolean; amountSats?: number }> {
  const grant = await prisma.cardActivationBonus.findUnique({
    where: { cardId_kind: { cardId: input.cardId, kind: 'SATS' } }
  })
  if (!grant || grant.status === 'REDEEMED') {
    return { granted: false }
  }
  if (
    !input.userWalletId ||
    !grant.amountSats ||
    grant.amountSats <= 0 ||
    !grant.sourceWalletId
  ) {
    return { granted: false, amountSats: grant.amountSats ?? undefined }
  }

  try {
    const [userWallet, treasury] = await Promise.all([
      prisma.remoteWallet.findUnique({
        where: { id: input.userWalletId }
      }),
      prisma.remoteWallet.findUnique({
        where: { id: grant.sourceWalletId }
      })
    ])
    if (!userWallet || userWallet.status !== 'ACTIVE') {
      throw new Error('User wallet missing or inactive')
    }
    if (!treasury || treasury.status !== 'ACTIVE') {
      throw new Error('Treasury wallet missing or inactive')
    }

    const dest = driverForWallet(userWallet)
    const invoice = await dest.driver.makeInvoice(dest.config, {
      amountSats: grant.amountSats,
      description: 'Card activation bonus'
    })
    const source = driverForWallet(treasury)
    await source.driver.payInvoice(source.config, { bolt11: invoice.bolt11 })

    await prisma.cardActivationBonus.update({
      where: { id: grant.id },
      data: { status: 'REDEEMED' }
    })
    return { granted: true, amountSats: grant.amountSats }
  } catch (err) {
    logger.error(
      {
        cardId: input.cardId,
        userWalletId: input.userWalletId,
        sourceWalletId: grant.sourceWalletId,
        amountSats: grant.amountSats,
        err: String(err)
      },
      'Card activation sats bonus payment failed'
    )
    return { granted: false, amountSats: grant.amountSats }
  }
}

export async function hasReservedFreeAddress(
  userId: string,
  client: PrismaLike = prisma
): Promise<boolean> {
  const grant = await client.cardActivationBonus.findFirst({
    where: { userId, kind: 'FREE_ADDRESS', status: 'RESERVED' },
    select: { id: true }
  })
  return !!grant
}

/** Mark the caller's reserved FREE_ADDRESS grant as used. */
export async function redeemFreeAddressReservation(
  userId: string
): Promise<boolean> {
  const grant = await prisma.cardActivationBonus.findFirst({
    where: { userId, kind: 'FREE_ADDRESS', status: 'RESERVED' },
    select: { id: true }
  })
  if (!grant) return false
  await prisma.cardActivationBonus.update({
    where: { id: grant.id },
    data: { status: 'REDEEMED' }
  })
  return true
}
