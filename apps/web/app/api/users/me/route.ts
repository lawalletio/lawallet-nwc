import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNewUser } from '@/lib/user'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolvePublicEndpoint } from '@/lib/public-url'
import { resolvePaymentRoute } from '@/lib/wallet/resolve-payment-route'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandling(async (request: Request) => {
  const { pubkey: authenticatedPubkey } = await authenticate(request)

    const existingUser = await prisma.user.findUnique({
      where: {
        pubkey: authenticatedPubkey
      },
      include: {
        // The user's "primary" address (at most one). Existing rows were
        // back-filled with isPrimary=true in the addresses_nwc_connection
        // migration, so behavior is preserved for legacy clients.
        // Pull the linked NWCConnection too so we can run the full
        // `resolvePaymentRoute` on it below — the dashboard needs the
        // same resolution an address-detail page would do, since balance
        // is only meaningful when the primary address is actually
        // routable (CUSTOM_NWC / DEFAULT_NWC with a connection).
        lightningAddresses: {
          where: { isPrimary: true },
          take: 1,
          include: { nwcConnection: true },
        },
        albySubAccount: true,
        // Primary NWCConnection is the canonical source of the user's
        // default NWC — same lookup the DEFAULT_NWC lightning-address mode
        // uses, so the dashboard card and an address set to "Default NWC"
        // always target the same wallet.
        nwcConnections: { where: { isPrimary: true }, take: 1 },
      }
    })

    const user = existingUser || (await createNewUser(authenticatedPubkey))

    // Resolve host with subdomain fallback (subdomain empty → use domain)
    const { host } = await resolvePublicEndpoint(request)
    const primaryAddress = user.lightningAddresses[0]
    const lightningAddress = primaryAddress?.username
      ? `${primaryAddress.username}@${host}`
      : null

  // Priority matches `resolvePaymentRoute` for DEFAULT_NWC:
  //   1. Primary NWCConnection — the new first-class wallet record.
  //   2. Legacy `User.nwc` — accounts set up before the NWCConnection
  //      model existed; kept so migrations can be lazy.
  //   3. Auto-provisioned Alby sub-account — fallback for community
  //      members that never configured an external wallet.
  // Keeping one source of truth means the dashboard NwcCard and an
  // address in DEFAULT_NWC mode always reflect the same underlying
  // connection, balance, and relay health.
  const primaryConnection = user.nwcConnections[0] ?? null
  const nwcString =
    primaryConnection?.connectionString
    ?? user.nwc
    ?? user.albySubAccount?.nwcUri
    ?? ''
  const nwcUpdatedAt = primaryConnection
    ? primaryConnection.updatedAt.toISOString()
    : user.nwc
      ? user.nwcUpdatedAt?.toISOString() ?? null
      : user.albySubAccount?.createdAt?.toISOString() ?? null

  // Run the same resolver the LUD-16 endpoint uses, but against the
  // *primary* lightning address. The dashboard balance widget should only
  // pull funds info when the primary address is actually routable:
  //   - CUSTOM_NWC → the address's linked connection
  //   - DEFAULT_NWC → user's primary NWCConnection (with legacy fallback)
  //   - IDLE / ALIAS / unconfigured → null, caller renders empty state
  // `primaryAddressMode` is returned alongside so the UI can phrase the
  // empty-state reason accurately.
  const effectiveNwcString = primaryAddress
    ? (() => {
        const route = resolvePaymentRoute({
          mode: primaryAddress.mode,
          redirect: primaryAddress.redirect,
          nwcConnection: primaryAddress.nwcConnection,
          primaryNwcConnection: primaryConnection,
          userNwc: user.nwc,
        })
        return route.kind === 'nwc' ? route.connectionString : null
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
