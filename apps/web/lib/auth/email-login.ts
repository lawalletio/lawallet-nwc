import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { generateCredential, hashCredential } from '@/lib/oauth/grants'
import { decryptNsec, encryptNsec, isVaultConfigured } from '@/lib/auth/key-vault'
import { generatePrivateKey, getPublicKeyFromPrivate } from '@/lib/nostr'
import { createNewUser } from '@/lib/user'
import { isEmailConfigured } from '@/lib/email/send'
import { logger } from '@/lib/logger'
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

/** Creates a token for `email`; returns the raw token (goes only into the link). */
export async function issueEmailLoginToken(email: string): Promise<string> {
  const token = generateCredential('')
  const now = new Date()
  await prisma.emailLoginToken.create({
    data: {
      tokenHash: hashCredential(token),
      email,
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
export async function peekEmailLoginToken(token: string): Promise<string> {
  const row = await prisma.emailLoginToken.findUnique({
    where: { tokenHash: hashCredential(token) }
  })
  if (!row || row.usedAt || row.expiresAt <= new Date()) {
    throw new AuthenticationError(INVALID_LINK)
  }
  return row.email
}

/** Atomically consumes a token; returns its email. */
export async function consumeEmailLoginToken(token: string): Promise<string> {
  const tokenHash = hashCredential(token)
  const now = new Date()
  const { count } = await prisma.emailLoginToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now }
  })
  if (count !== 1) throw new AuthenticationError(INVALID_LINK)
  const row = await prisma.emailLoginToken.findUnique({ where: { tokenHash } })
  if (!row) throw new AuthenticationError(INVALID_LINK)
  return row.email
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, pubkey: true, managedNostrKey: true }
  })
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
      // ponytail: only the email flow sets User.email, so this is a data
      // anomaly (e.g. restored without ManagedNostrKey). Surface it.
      throw new ConflictError(
        'This account has no hosted key — sign in with your Nostr key instead'
      )
    }
    return {
      secretHex: decryptNsec(existing.managedNostrKey.ciphertext, existing.id),
      pubkey: existing.pubkey,
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
      prisma.user.update({ where: { id: userId }, data: { email } }),
      prisma.managedNostrKey.create({
        // Fresh Buffer: Prisma's Bytes wants Uint8Array<ArrayBuffer>.
        data: { userId, ciphertext: Buffer.from(encryptNsec(secretHex, userId)) }
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
