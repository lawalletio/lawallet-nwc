import { NextResponse } from 'next/server'
import { resolveAddressProtocols } from '@/lib/wallet/address-protocols'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { createNewUser } from '@/lib/user'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { provisionLightningAddressSchema } from '@/lib/validation/schemas'
import { createLightningAddressForUser } from '@/lib/wallet/create-address'
import { deriveEffectiveNwcMode } from '@/lib/wallet/wallet-address-dto'
import { derivePrimaryWallet } from '@/lib/wallet/primary-wallet'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/lightning-addresses
 *
 * Global admin list (gated by ADDRESSES_READ): one row per LightningAddress
 * across all users. Each row carries the per-address fields plus the
 * effective `nwcMode` (derived from the bound or default RemoteWallet) so
 * the admin UI doesn't have to re-derive it.
 */
export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.ADDRESSES_READ)

  const addresses = await prisma.lightningAddress.findMany({
    include: {
      remoteWallet: true,
      user: {
        select: {
          id: true,
          pubkey: true,
          nostrIdentities: {
            where: { isPrimary: true },
            select: { pubkey: true },
            take: 1
          },
          // Pull each owner's primary address so the derived NWC capability
          // resolves without N+1 queries.
          lightningAddresses: {
            where: { isPrimary: true },
            take: 1,
            include: { remoteWallet: true }
          }
        }
      }
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }]
  })

  const transformed = await Promise.all(
    addresses.map(async address => ({
      username: address.username,
      pubkey: address.user.pubkey,
      mode: address.mode,
      redirect: address.redirect,
      remoteWalletId: address.remoteWalletId,
      remoteWalletName: address.remoteWallet?.name ?? null,
      isPrimary: address.isPrimary,
      nwcMode: deriveEffectiveNwcMode(
        address,
        derivePrimaryWallet(address.user.lightningAddresses?.[0])
      ),
      createdAt: address.createdAt.toISOString(),
      updatedAt: address.updatedAt.toISOString(),
      protocols: await resolveAddressProtocols({
        mode: address.mode,
        redirect: address.redirect,
        aliasProtocols: address.aliasProtocols,
        routable: address.remoteWallet?.status === 'ACTIVE',
        user: address.user
      })
    }))
  )

  return NextResponse.json(transformed)
})

/**
 * POST /api/lightning-addresses
 *
 * Operator provisioning: create an address for SOMEBODY ELSE'S pubkey, gated
 * by ADDRESSES_WRITE (ADMIN or OPERATOR). The target account is created on
 * demand, so a pubkey that has never touched this instance can be handed a
 * reserved address.
 *
 * Deliberately skips `requireAddressRegistration`: that guard encodes the
 * *self-service* policy (the "User Registration" toggle and paid
 * registration), and the whole point of this endpoint is the operator acting
 * out-of-band — typically on an instance where self-service is switched off.
 *
 * The counterpart for a user creating their own address is
 * POST /api/wallet/addresses.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const auth = await authenticateWithPermission(
    request,
    Permission.ADDRESSES_WRITE
  )
  const { username, pubkey } = await validateBody(
    request,
    provisionLightningAddressSchema
  )

  // Resolve-or-create the target account, exactly as /api/admin/assign does
  // when it promotes a pubkey nobody has seen before.
  const account = await resolveAccountByPubkey(pubkey)
  const user = account ?? (await createNewUser(pubkey))

  const dto = await createLightningAddressForUser({
    userId: user.id,
    username,
    provisionedBy: auth.pubkey
  })

  // Echo the account's PRIMARY pubkey: provisioning against a secondary
  // identity still belongs to the one account, and the admin list above
  // reports `user.pubkey`, so the two stay consistent.
  return NextResponse.json(
    { ...dto, pubkey: account?.primaryPubkey ?? pubkey },
    { status: 201 }
  )
})
