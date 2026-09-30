import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNewUser } from '@/lib/user'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { resolveAddressDomain } from '@/lib/public-url'
import { resolveWalletRoute } from '@/lib/wallet/resolve-payment-route'
import { getPrimaryRemoteWalletForUser } from '@/lib/wallet/primary-wallet'
import { decryptRemoteWalletConfig } from '@/lib/wallet/remote-wallet-vault'
import { currencyPrefsSchema } from '@/lib/validation/schemas'
import {
  mintCourtesyLncurlWallet,
  replaceDeadLncurlPrimaryWallet
} from '@/lib/wallet/lncurl-wallet'
import { eventBus } from '@/lib/events/event-bus'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

function publishedCurrencyPrefs(value: unknown) {
  const parsed = currencyPrefsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const GET = withErrorHandling(async (request: Request) => {
  const { pubkey: authenticatedPubkey } = await authenticate(request)

  // Any linked pubkey (primary or secondary identity) resolves to the same
  // account; a truly unknown pubkey materialises a fresh one below.
  const account = await resolveAccountByPubkey(authenticatedPubkey)
  const existingUser = account
    ? await prisma.user.findUnique({
        where: { id: account.id },
        include: {
          // The user's "primary" address (at most one). Pull its bound
          // RemoteWallet so we can run `resolveWalletRoute` on it below — the
          // dashboard needs the same resolution an address-detail page does,
          // since balance is only meaningful when the primary address is
          // actually routable (CUSTOM_NWC / DEFAULT_NWC with a wallet).
          lightningAddresses: {
            where: { isPrimary: true },
            take: 1,
            include: { remoteWallet: true }
          }
        }
      })
    : null

  const user = existingUser || (await createNewUser(authenticatedPubkey))

  // Lightning addresses resolve as `username@<domain>`. The `endpoint`
  // setting (where the instance is publicly reachable) may differ from
  // the address domain — e.g. `endpoint=https://beta.lacrypta.ar` while
  // `domain=lacrypta.ar` — so `resolveAddressDomain` reads the address
  // domain directly rather than `resolvePublicEndpoint`, which mixes the
  // two concerns.
  const addressDomain = await resolveAddressDomain(request)
  let primaryAddress = user.lightningAddresses[0]
  const boundWallet = primaryAddress?.remoteWallet
  const replaced =
    primaryAddress && boundWallet?.status === 'DEAD' && boundWallet.id
      ? await replaceDeadLncurlPrimaryWallet({
          userId: user.id,
          mode: primaryAddress.mode,
          boundWallet: {
            id: boundWallet.id,
            status: boundWallet.status,
            config: boundWallet.config
          }
        })
      : null
  if (replaced && primaryAddress) {
    primaryAddress = {
      ...primaryAddress,
      remoteWalletId: replaced.id,
      remoteWallet: replaced
    }
    eventBus.emit({ type: 'listener:updated', timestamp: Date.now() })
    eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
    eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
  }

  // A paid claim that ran when the account had no address used to insert a
  // non-primary row. The account then has names and no primary, so nothing
  // here can bind a wallet. Promote the oldest one; the block below mints.
  if (!primaryAddress) {
    const stray = await prisma.lightningAddress.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      include: { remoteWallet: true }
    })
    if (stray) {
      await prisma.lightningAddress.update({
        where: { username: stray.username },
        data: { isPrimary: true }
      })
      primaryAddress = { ...stray, isPrimary: true }
    }
  }

  // A claim that finished with no wallet is stored as IDLE and only publishes
  // NIP-05. When LNCurl is on and the account still has no ACTIVE wallet,
  // mint one and bind this primary address now.
  if (
    primaryAddress &&
    primaryAddress.mode === 'IDLE' &&
    !primaryAddress.remoteWalletId
  ) {
    try {
      const minted = await mintCourtesyLncurlWallet(user.id, {
        bindPrimary: true
      })
      if (minted) {
        const refreshed = await prisma.lightningAddress.findUnique({
          where: { username: primaryAddress.username },
          include: { remoteWallet: true }
        })
        if (refreshed) primaryAddress = refreshed
        eventBus.emit({ type: 'listener:updated', timestamp: Date.now() })
        eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
        eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
      }
    } catch (err) {
      logger.error(
        { userId: user.id, err: String(err) },
        'LNCurl auto-create failed for an unconfigured primary address'
      )
    }
  }
  const lightningAddress = primaryAddress?.username
    ? `${primaryAddress.username}@${addressDomain}`
    : null

  // The account primary wallet is derived from the primary address's
  // CUSTOM_NWC binding. The legacy/display isDefault flag is synchronized from
  // that link, but is no longer the source of truth.
  const primaryWallet =
    replaced ?? (await getPrimaryRemoteWalletForUser(user.id))
  const primaryWalletConfig = primaryWallet
    ? decryptRemoteWalletConfig(
        primaryWallet.id,
        primaryWallet.type,
        primaryWallet.config
      )
    : null
  const primaryWalletConn =
    typeof primaryWalletConfig?.connectionString === 'string'
      ? primaryWalletConfig.connectionString
      : null
  const nwcString = primaryWalletConn ?? ''
  const nwcUpdatedAt = primaryWallet?.updatedAt.toISOString() ?? null

  // Run the same resolver the LUD-16 endpoint uses, but against the
  // *primary* lightning address. This is the wallet the address routes to:
  //   - CUSTOM_NWC → the address's bound RemoteWallet
  //   - DEFAULT_NWC → the wallet linked to the primary address (legacy rows)
  //   - IDLE / ALIAS / unconfigured → null
  // `primaryAddressMode` is returned alongside so the UI can phrase the
  // empty-state reason accurately.
  const effectiveNwcString = primaryAddress
    ? (() => {
        const route = resolveWalletRoute({
          mode: primaryAddress.mode,
          redirect: primaryAddress.redirect,
          remoteWallet: primaryAddress.remoteWallet
        })
        return route.kind === 'wallet'
          ? ((route.config as { connectionString?: string } | null)
              ?.connectionString ?? null)
          : null
      })()
    : null

  return NextResponse.json({
    userId: user.id,
    lightningAddress,
    nwcString,
    nwcUpdatedAt,
    effectiveNwcString,
    primaryAddressMode: primaryAddress?.mode ?? null,
    // Raw fields the dashboard needs to render the non-NWC (IDLE/ALIAS)
    // card without splitting `lightningAddress` on `@` or re-fetching
    // the address detail endpoint.
    primaryUsername: primaryAddress?.username ?? null,
    primaryRedirect: primaryAddress?.redirect ?? null,
    currencyPrefs: publishedCurrencyPrefs(user.currencyPrefs)
  })
})
