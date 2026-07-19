import { randomUUID } from 'crypto'
import { AlbyHub } from './albyhub'
import { prisma } from './prisma'
import { getSettings } from './settings'
import { ActivityEvent, logActivity } from './activity-log'
import { logger } from './logger'
import { createLncurlRemoteWallet } from './wallet/lncurl-wallet'

/**
 * Creates a brand-new `User` record for an authenticated pubkey, optionally
 * provisioning an Alby Hub sub-account when `alby_auto_generate` is enabled
 * and Alby credentials are configured.
 *
 * The returned shape mirrors what `findUnique` callers (notably
 * `/api/users/me`) expect — the primary `LightningAddress` with its bound
 * `remoteWallet`. RemoteWallet rows created before a primary address exists
 * are candidates for that future address, not primary by themselves.
 *
 * When an Alby sub-account is provisioned, its pairing URI is stored as the
 * a RemoteWallet (RemoteWallet is the single source of truth for wallets —
 * there's no separate `User.nwc` / `NWCConnection`).
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
  },
) {
  const {
    alby_api_url,
    alby_bearer_token,
    alby_auto_generate,
    lncurl_auto_create,
    lncurl_server_url,
  } = await getSettings([
    'alby_api_url',
    'alby_bearer_token',
    'alby_auto_generate',
    'lncurl_auto_create',
    'lncurl_server_url',
  ])
  const userId = opts?.userId ?? randomUUID()

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
      // Provisioned Alby wallet waits for the user's primary address to bind
      // to it; `isDefault` is synchronized from that address link.
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
              isDefault: false,
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
      // Compatibility/display primary RemoteWallet, if already synchronized.
      remoteWallets: { where: { isDefault: true }, take: 1 },
    }
  })

  // When there's no Alby sub-account but LNCurl auto-provisioning is on,
  // prepare a wallet candidate for the first primary address to bind to.
  // Best-effort: any failure (LNCurl down, etc.) must NOT break signup — we
  // swallow it and the user simply starts with no wallet.
  if (!subAccount && lncurl_auto_create === 'true') {
    try {
      const lncurlWallet = await createLncurlRemoteWallet({
        userId: user.id,
        serverUrl: lncurl_server_url || undefined,
      })
      user.remoteWallets = lncurlWallet.isDefault ? [lncurlWallet] : []
    } catch (err) {
      // Structured log so the operator can spot intermittent provider outages
      // (the user just starts wallet-less and can connect one later).
      logger.error(
        { userId: user.id, err: String(err) },
        'LNCurl auto-create failed during signup',
      )
    }
  }

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.USER_SIGNUP,
    message: `New user signed up (${pubkey.slice(0, 8)}…)`,
    userId: user.id,
    metadata: { pubkey, albyEnabled: user.albyEnabled },
  })

  return user
}
