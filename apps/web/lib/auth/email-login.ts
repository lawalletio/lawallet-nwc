import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { generateCredential, hashCredential } from '@/lib/oauth/grants'
import {
  decryptNsec,
  encryptNsec,
  isVaultConfigured
} from '@/lib/auth/key-vault'
import { generatePrivateKey, getPublicKeyFromPrivate } from '@/lib/nostr'
import { createNewUser } from '@/lib/user'
import { isEmailConfigured } from '@/lib/email/send'
import { logger } from '@/lib/logger'
import { EMAIL_SIGN_IN_KEY_LABEL } from '@/lib/account/merge'
import {
  AuthenticationError,
  ConflictError,
  NotFoundError
} from '@/types/server/errors'

/**
 * Email magic-link login. A token is 256 random bits (base64url); only its
 * SHA-256 is stored, it lives 15 minutes and is single-use (conditional
 * update on `usedAt`). The same flow signs in a known email and signs up an
 * unknown one — new users get a server-custodied Nostr key (key vault).
 */

export const EMAIL_LOGIN_TTL_MINUTES = 15
const TTL_MS = EMAIL_LOGIN_TTL_MINUTES * 60_000

/** Every failure looks the same to the caller — no oracle for token state. */
const INVALID_LINK = 'This sign-in link is invalid or has expired'

export async function assertEmailLoginEnabled(): Promise<void> {
  const settings = await getSettings()
  if (
    settings.email_login_enabled !== 'true' ||
    !isEmailConfigured(settings) ||
    !isVaultConfigured()
  ) {
    throw new NotFoundError('Email login is not enabled')
  }
}

/** `alice@example.com` → `a•••e@example.com`. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  const masked =
    local.length <= 2
      ? `${local[0]}•••`
      : `${local[0]}•••${local[local.length - 1]}`
  return `${masked}@${domain}`
}

/**
 * `login` tokens sign in (or up); `link` tokens attach the email to the
 * account that requested them. A token only ever works for its own purpose.
 */
export type EmailTokenPurpose = 'login' | 'link'

export interface EmailTokenClaims {
  email: string
  /** The requesting account, for `link` tokens. */
  linkUserId: string | null
}

const purposeFilter = (purpose: EmailTokenPurpose) =>
  purpose === 'link' ? { linkUserId: { not: null } } : { linkUserId: null }

/** Creates a token for `email`; returns the raw token (goes only into the link). */
export async function issueEmailLoginToken(
  email: string,
  linkUserId?: string
): Promise<string> {
  const token = generateCredential('')
  const now = new Date()
  await prisma.emailLoginToken.create({
    data: {
      tokenHash: hashCredential(token),
      email,
      linkUserId: linkUserId ?? null,
      expiresAt: new Date(now.getTime() + TTL_MS)
    }
  })
  // Opportunistic purge (same approach as WebAuthn challenges).
  prisma.emailLoginToken
    .deleteMany({ where: { expiresAt: { lt: now } } })
    .catch(() => {})
  return token
}

/** Looks a token up WITHOUT consuming it (landing preview). */
export async function peekEmailLoginToken(
  token: string,
  purpose: EmailTokenPurpose = 'login'
): Promise<EmailTokenClaims> {
  const row = await prisma.emailLoginToken.findUnique({
    where: { tokenHash: hashCredential(token) }
  })
  if (
    !row ||
    row.usedAt ||
    row.expiresAt <= new Date() ||
    (purpose === 'link') !== (row.linkUserId != null)
  ) {
    throw new AuthenticationError(INVALID_LINK)
  }
  return { email: row.email, linkUserId: row.linkUserId ?? null }
}

/** Atomically consumes a token of `purpose`; returns its claims. */
export async function consumeEmailLoginToken(
  token: string,
  purpose: EmailTokenPurpose = 'login'
): Promise<EmailTokenClaims> {
  const tokenHash = hashCredential(token)
  const now = new Date()
  const { count } = await prisma.emailLoginToken.updateMany({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: now },
      ...purposeFilter(purpose)
    },
    data: { usedAt: now }
  })
  if (count !== 1) throw new AuthenticationError(INVALID_LINK)
  const row = await prisma.emailLoginToken.findUnique({ where: { tokenHash } })
  if (!row) throw new AuthenticationError(INVALID_LINK)
  return { email: row.email, linkUserId: row.linkUserId ?? null }
}

/** The account an email signs in to, if any. */
export async function findUserByEmail(email: string) {
  const identity = await prisma.emailIdentity.findUnique({
    where: { email },
    select: {
      user: { select: { id: true, pubkey: true, managedNostrKey: true } }
    }
  })
  return identity?.user ?? null
}

export interface EmailLoginResult {
  secretHex: string
  pubkey: string
  isNew: boolean
}

/** Returns the account's custodied key, creating the account if needed. */
export async function loginOrSignupByEmail(
  email: string
): Promise<EmailLoginResult> {
  const existing = await findUserByEmail(email)
  if (existing) {
    if (!existing.managedNostrKey) {
      // Linking an email always provisions a hosted key, so this is a data
      // anomaly (e.g. a restore without ManagedNostrKey). Surface it.
      throw new ConflictError(
        'This account has no hosted key — sign in with your Nostr key instead'
      )
    }
    const secretHex = decryptNsec(
      existing.managedNostrKey.ciphertext,
      existing.id
    )
    // The hosted key may be a secondary identity (email linked later); any
    // linked key signs in, and the session presents the primary.
    return {
      secretHex,
      pubkey: getPublicKeyFromPrivate(secretHex),
      isNew: false
    }
  }

  const userId = randomUUID()
  const secretHex = generatePrivateKey()
  const pubkey = getPublicKeyFromPrivate(secretHex)

  // Provisions the courtesy wallet and logs USER_SIGNUP.
  await createNewUser(pubkey, { userId })
  try {
    await prisma.$transaction([
      prisma.emailIdentity.create({ data: { email, userId } }),
      prisma.managedNostrKey.create({
        // Fresh Buffer: Prisma's Bytes wants Uint8Array<ArrayBuffer>.
        data: {
          userId,
          ciphertext: Buffer.from(encryptNsec(secretHex, userId))
        }
      })
    ])
  } catch (err) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {})
    // Two links for the same new email used at once: the other one won.
    if ((err as { code?: string } | null)?.code === 'P2002') {
      logger.info({ email: maskEmail(email) }, 'Email signup race; logging in')
      return loginOrSignupByEmail(email)
    }
    throw err
  }
  return { secretHex, pubkey, isNew: true }
}

/**
 * Attaches a verified, unclaimed `email` to `userId`. Email sign-in hands
 * back the account's hosted key, so an account without one (Nostr or
 * passkey only) gets a fresh key, linked as a secondary identity.
 * Throws 409 if the email was claimed in the meantime.
 */
export async function linkEmailToAccount(
  userId: string,
  email: string
): Promise<void> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { managedNostrKey: { select: { userId: true } } }
  })
  if (!account) throw new NotFoundError('Account not found')

  try {
    await prisma.$transaction(async tx => {
      if (!account.managedNostrKey) {
        const secretHex = generatePrivateKey()
        await tx.nostrIdentity.create({
          data: {
            pubkey: getPublicKeyFromPrivate(secretHex),
            userId,
            isPrimary: false,
            label: EMAIL_SIGN_IN_KEY_LABEL
          }
        })
        await tx.managedNostrKey.create({
          data: {
            userId,
            ciphertext: Buffer.from(encryptNsec(secretHex, userId))
          }
        })
      }
      await tx.emailIdentity.create({ data: { email, userId } })
    })
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'P2002') {
      throw new ConflictError('This email is already linked to an account')
    }
    throw err
  }
}

/**
 * Removes `email` from `userId`. Refused for the last email of an account
 * whose only key is the never-exported hosted one — it would lock the user
 * out. When the last email goes and the hosted key was only the email
 * sign-in identity, that key is removed with it.
 */
export async function unlinkEmailFromAccount(
  userId: string,
  email: string
): Promise<void> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      pubkey: true,
      emailIdentities: { select: { email: true } },
      managedNostrKey: { select: { ciphertext: true, exportedAt: true } }
    }
  })
  if (!account || !account.emailIdentities.some(e => e.email === email)) {
    throw new NotFoundError('Email not linked to this account')
  }

  const isLast = account.emailIdentities.length === 1
  const hostedPubkey = account.managedNostrKey
    ? getPublicKeyFromPrivate(
        decryptNsec(account.managedNostrKey.ciphertext, userId)
      )
    : null
  const hostedIsPrimary = hostedPubkey === account.pubkey

  if (isLast && hostedIsPrimary && !account.managedNostrKey?.exportedAt) {
    throw new ConflictError(
      'This is your only way to sign in. Export your secret key or add another email first.'
    )
  }

  await prisma.$transaction(async tx => {
    await tx.emailIdentity.delete({ where: { email } })
    if (isLast && hostedPubkey && !hostedIsPrimary) {
      // The email sign-in key has no purpose without an email.
      await tx.managedNostrKey.delete({ where: { userId } })
      await tx.nostrIdentity.deleteMany({
        where: { pubkey: hostedPubkey, userId, isPrimary: false }
      })
    }
  })
}
