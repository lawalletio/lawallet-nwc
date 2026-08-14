import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthenticationError, NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { requireAddressRegistration } from '@/lib/auth/paid-registration-guard'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { createWalletAddressSchema } from '@/lib/validation/schemas'
import { createLightningAddressForUser } from '@/lib/wallet/create-address'
import {
  toWalletAddressDto,
  type WalletAddressDto
} from '@/lib/wallet/wallet-address-dto'
import { resolveAddressProtocols } from '@/lib/wallet/address-protocols'
import { derivePrimaryWallet } from '@/lib/wallet/primary-wallet'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/wallet/addresses
 *
 * List the *authenticated user's own* lightning addresses, with the effective
 * NWC mode pre-derived per row. The admin endpoint at
 * /api/lightning-addresses returns the global list and is unaffected.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const { pubkey } = await authenticate(request)
  const account = await resolveAccountByPubkey(pubkey)
  const user = account
    ? await prisma.user.findUnique({
        where: { id: account.id },
        include: {
          lightningAddresses: {
            include: { remoteWallet: true },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
          }
        }
      })
    : null

  if (!user) throw new NotFoundError('User not found')
  const defaultWallet = derivePrimaryWallet(
    user.lightningAddresses.find(addr => addr.isPrimary)
  )

  // Alias protocols come from the probe stored at save time, so listing many
  // addresses never reaches out to their targets.
  const dtos: WalletAddressDto[] = await Promise.all(
    user.lightningAddresses.map(async addr => ({
      ...toWalletAddressDto(addr, defaultWallet),
      protocols: await resolveAddressProtocols({
        mode: addr.mode,
        redirect: addr.redirect,
        aliasProtocols: addr.aliasProtocols,
        routable: addr.remoteWallet?.status === 'ACTIVE',
        user
      })
    }))
  )
  return NextResponse.json(dtos)
})

/**
 * POST /api/wallet/addresses
 *
 * Create a new lightning address owned by the caller. Defaults to the
 * account's active wallet (CUSTOM_NWC) or IDLE, and isPrimary=false. Username uniqueness is enforced by the
 * primary key on `LightningAddress.username`, so we surface a clean
 * ConflictError instead of letting a P2002 leak.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const { pubkey, role } = await authenticate(request)
  const { username, mode } = await validateBody(
    request,
    createWalletAddressSchema
  )

  const user = await resolveAccountByPubkey(pubkey)
  if (!user) throw new AuthenticationError('User not found')

  // Gate self-service address creation behind the instance policy. When user
  // registration is disabled only admins pass; when paid registration is on,
  // non-bypassing actors must go through /api/invoices + preimage claim.
  await requireAddressRegistration(role)

  const dto = await createLightningAddressForUser({
    userId: user.id,
    username,
    mode
  })

  return NextResponse.json(dto, { status: 201 })
})
