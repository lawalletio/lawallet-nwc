import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNewUser } from '@/lib/user'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { getSettings } from '@/lib/settings'
import { resolveWalletRoute } from '@/lib/wallet/resolve-payment-route'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandling(async (request: Request) => {
  const { pubkey: authenticatedPubkey } = await authenticate(request)

    const existingUser = await prisma.user.findUnique({
      where: {
        pubkey: authenticatedPubkey
      },
      include: {
        // The user's "primary" address (at most one). Pull its bound
        // RemoteWallet so we can run `resolveWalletRoute` on it below — the
        // dashboard needs the same resolution an address-detail page does,
        // since balance is only meaningful when the primary address is
        // actually routable (CUSTOM_NWC / DEFAULT_NWC with a wallet).
        lightningAddresses: {
          where: { isPrimary: true },
          take: 1,
          include: { remoteWallet: true },
        },
        albySubAccount: true,
        // The default RemoteWallet is the canonical source of the user's
        // primary wallet — same lookup the DEFAULT_NWC lightning-address
        // mode uses, so the dashboard card and a "Default" address always
        // target the same wallet.
        remoteWallets: {
          where: { isDefault: true, status: 'ACTIVE' },
          take: 1,
        },
      }
    })

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

  // The user's default RemoteWallet is the single source of truth for the
  // dashboard's "primary wallet". Its connection string drives the balance
  // widget; the same wallet backs a "Default" lightning address, so the
  // card and a DEFAULT_NWC address always reflect the same wallet.
  const defaultWallet = user.remoteWallets[0] ?? null
  const defaultWalletConn =
    (defaultWallet?.config as { connectionString?: string } | null)?.connectionString ?? null
  const nwcString = defaultWalletConn ?? ''
  const nwcUpdatedAt = defaultWallet?.updatedAt.toISOString() ?? null

  // Run the same resolver the LUD-16 endpoint uses, but against the
  // *primary* lightning address. This is the wallet the address routes to —
  // NOT necessarily the user's spendable wallet (the client falls back to
  // `nwcString`, the default wallet, when this is null):
  //   - CUSTOM_NWC → the address's bound RemoteWallet
  //   - DEFAULT_NWC → the user's default RemoteWallet
  //   - IDLE / ALIAS / unconfigured → null
  // `primaryAddressMode` is returned alongside so the UI can phrase the
  // empty-state reason accurately.
  const effectiveNwcString = primaryAddress
    ? (() => {
        const route = resolveWalletRoute({
          mode: primaryAddress.mode,
          redirect: primaryAddress.redirect,
          remoteWallet: primaryAddress.remoteWallet,
          defaultRemoteWallet: defaultWallet,
        })
        return route.kind === 'wallet'
          ? ((route.config as { connectionString?: string } | null)?.connectionString ?? null)
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
    primaryRedirect: primaryAddress?.redirect ?? null,
  })
})
