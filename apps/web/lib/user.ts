import { randomUUID } from 'crypto'
import { AlbyHub } from './albyhub'
import { prisma } from './prisma'
import { getSettings } from './settings'
import { ActivityEvent, logActivity } from './activity-log'

/**
 * Creates a brand-new `User` record for an authenticated pubkey, optionally
 * provisioning an Alby Hub sub-account when `alby_auto_generate` is enabled
 * and Alby credentials are configured.
 *
 * The returned shape mirrors what `findUnique` callers (notably
 * `/api/users/me`) expect — the primary `LightningAddress` with its bound
 * `remoteWallet`, plus the user's default `RemoteWallet` — so the union of
 * "fresh signup" and "existing user" stays a single shape downstream.
 *
 * When an Alby sub-account is provisioned, its pairing URI is stored as the
 * user's default RemoteWallet (RemoteWallet is the single source of truth
 * for wallets — there's no separate `User.nwc` / `NWCConnection`).
 *
 * Also fires (best-effort, non-blocking) a `USER_SIGNUP` activity log entry.
 */
export async function createNewUser(pubkey: string) {
  const { alby_api_url, alby_bearer_token, alby_auto_generate } =
    await getSettings([
      'alby_api_url',
      'alby_bearer_token',
      'alby_auto_generate'
    ])
  const userId = randomUUID()

  const albyHub = new AlbyHub(alby_api_url, alby_bearer_token)

  const subAccount =
    alby_auto_generate === 'true'
      ? await albyHub.createSubAccount(`LaWallet-${userId}`)
      : null

  const user = await prisma.user.create({
    data: {
      id: userId,
      pubkey,
      createdAt: new Date(),
      albyEnabled: !!subAccount,
      albySubAccount: subAccount
        ? {
            create: {
              appId: subAccount.id,
              nwcUri: subAccount.pairingUri,
              username: subAccount.lud16,
              nostrPubkey: subAccount.walletPubkey
            }
          }
        : undefined,
      // Provisioned Alby wallet becomes the user's default RemoteWallet.
      remoteWallets: subAccount
        ? {
            create: {
              name: 'NWC Wallet',
              type: 'NWC',
              config: {
                connectionString: subAccount.pairingUri,
                mode: 'SEND_RECEIVE',
              },
              status: 'ACTIVE',
              isDefault: true,
            },
          }
        : undefined,
    },
    include: {
      // Pull only the primary address (at most one). Include its bound
      // RemoteWallet so the return shape matches the `findUnique` path that
      // feeds /api/users/me — otherwise TS narrows the union and drops it.
      lightningAddresses: {
        where: { isPrimary: true },
        take: 1,
        include: { remoteWallet: true },
      },
      albySubAccount: true,
      // Default RemoteWallet — matches the `findUnique` callers' shape.
      remoteWallets: { where: { isDefault: true }, take: 1 },
    }
  })

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.USER_SIGNUP,
    message: `New user signed up (${pubkey.slice(0, 8)}…)`,
    userId: user.id,
    metadata: { pubkey, albyEnabled: user.albyEnabled },
  })

  return user
}
