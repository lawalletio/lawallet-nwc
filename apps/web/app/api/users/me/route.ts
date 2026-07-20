import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNewUser } from '@/lib/user'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { getSettings } from '@/lib/settings'
import { resolveWalletRoute } from '@/lib/wallet/resolve-payment-route'
import { getPrimaryRemoteWalletForUser } from '@/lib/wallet/primary-wallet'

export const dynamic = 'force-dynamic'

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
          },
          albySubAccount: true
        }
      })
    : null

  const user = existingUser || (await createNewUser(authenticatedPubkey))

  // Lightning addresses resolve as `username@<domain>`. The `endpoint`
  // setting (where the instance is publicly reachable) may differ from
  // the address domain — e.g. `endpoint=https://beta.lacrypta.ar` while
  // `domain=lacrypta.ar` — so we read the address domain directly here
  // rather than via `resolvePublicEndpoint`, which mixes the two concerns.
  const { domain } = await getSettings(['domain'])
  const addressDomain =
    domain?.trim() || request.headers.get('host') || new URL(request.url).host
  const primaryAddress = user.lightningAddresses[0]
  const lightningAddress = primaryAddress?.username
    ? `${primaryAddress.username}@${addressDomain}`
    : null

  // The account primary wallet is derived from the primary address's
  // CUSTOM_NWC binding. The legacy/display isDefault flag is synchronized from
  // that link, but is no longer the source of truth.
  const primaryWallet = await getPrimaryRemoteWalletForUser(user.id)
  const primaryWalletConn =
    (primaryWallet?.config as { connectionString?: string } | null)
      ?.connectionString ?? null
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
          remoteWallet: primaryAddress.remoteWallet,
          defaultRemoteWallet: primaryWallet
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
    albySubAccount: user.albySubAccount
      ? {
          appId: user.albySubAccount.appId,
          nwcUri: user.albySubAccount.nwcUri,
          username: user.albySubAccount.username
        }
      : null,
    nwcString,
    nwcUpdatedAt,
    effectiveNwcString,
    primaryAddressMode: primaryAddress?.mode ?? null,
    // Raw fields the dashboard needs to render the non-NWC (IDLE/ALIAS)
    // card without splitting `lightningAddress` on `@` or re-fetching
    // the address detail endpoint.
    primaryUsername: primaryAddress?.username ?? null,
    primaryRedirect: primaryAddress?.redirect ?? null
  })
})
