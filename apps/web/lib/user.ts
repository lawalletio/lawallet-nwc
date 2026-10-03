import { randomUUID } from 'crypto'
import { prisma } from './prisma'
import { getSettings } from './settings'
import { ActivityEvent, logActivity } from './activity-log'
import { logger } from './logger'
import { createLncurlRemoteWallet } from './wallet/lncurl-wallet'
import { ServiceUnavailableError } from '@/types/server/errors'

/**
 * Creates a brand-new `User` record for an authenticated pubkey, provisioning
 * an LNCurl courtesy wallet when `lncurl_auto_create` is enabled. A mint
 * failure deletes the new row and throws, so signup does not succeed with
 * no wallet.
 *
 * The returned shape mirrors what `findUnique` callers (notably
 * `/api/users/me`) expect — the primary `LightningAddress` with its bound
 * `remoteWallet`. RemoteWallet rows created before a primary address exists
 * are candidates for that future address, not primary by themselves.
 *
 * Also fires (best-effort, non-blocking) a `USER_SIGNUP` activity log entry.
 */
export async function createNewUser(
  pubkey: string,
  opts?: {
    /**
     * Pre-allocated user id. The passkey registration flow reserves the id at
     * options time (it travels as the WebAuthn user handle) and materializes
     * the row here on verify.
     */
    userId?: string
  }
) {
  const { lncurl_auto_create, lncurl_server_url } = await getSettings([
    'lncurl_auto_create',
    'lncurl_server_url'
  ])
  const userId = opts?.userId ?? randomUUID()

  const user = await prisma.user.create({
    data: {
      id: userId,
      pubkey,
      createdAt: new Date(),
      // The signup pubkey is the account's primary Nostr identity;
      // User.pubkey stays a denormalized mirror of it (see NostrIdentity).
      nostrIdentities: {
        create: { pubkey, isPrimary: true }
      }
    },
    include: {
      // Pull only the primary address (at most one). Include its bound
      // RemoteWallet so the return shape matches the `findUnique` path that
      // feeds /api/users/me — otherwise TS narrows the union and drops it.
      lightningAddresses: {
        where: { isPrimary: true },
        take: 1,
        include: { remoteWallet: true }
      },
      // Compatibility/display primary RemoteWallet, if already synchronized.
      remoteWallets: { where: { isDefault: true }, take: 1 }
    }
  })

  // When LNCurl auto-provisioning is on, the account is not usable without
  // the courtesy wallet. A mint failure rolls the new user back and surfaces
  // as 503 so signup can be retried — it must not succeed with no wallet.
  if (lncurl_auto_create === 'true') {
    try {
      const lncurlWallet = await createLncurlRemoteWallet({
        userId: user.id,
        serverUrl: lncurl_server_url || undefined
      })
      user.remoteWallets = lncurlWallet.isDefault ? [lncurlWallet] : []
    } catch (err) {
      logger.error(
        { userId: user.id, err: String(err) },
        'LNCurl auto-create failed during signup'
      )
      try {
        await prisma.user.delete({ where: { id: user.id } })
      } catch (deleteErr) {
        logger.error(
          { userId: user.id, err: String(deleteErr) },
          'Failed to roll back user after LNCurl signup mint failure'
        )
      }
      throw new ServiceUnavailableError(
        'Could not create a wallet. Try again.'
      )
    }
  }

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.USER_SIGNUP,
    message: `New user signed up (${pubkey.slice(0, 8)}…)`,
    userId: user.id,
    metadata: { pubkey }
  })

  return user
}
