import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import { ValidationError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { createInvoiceSchema } from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'
import { extractPaymentHash } from '@/lib/invoice-utils'
import { resolveInvoice } from '@/lib/lnurl-probe'

export const dynamic = 'force-dynamic'

export const POST = withErrorHandling(async (request: NextRequest) => {
  await checkRequestLimits(request, 'json')
  const { pubkey } = await authenticate(request)
  const body = await validateBody(request, createInvoiceSchema)

  // Resolve the user
  const user = await prisma.user.findUnique({ where: { pubkey } })
  if (!user) {
    throw new ValidationError('User not found')
  }

  // Load registration settings
  const settings = await getSettings([
    'registration_ln_address',
    'registration_price',
    'registration_ln_enabled',
  ])

  const lnAddress = settings.registration_ln_address
  const price = parseInt(settings.registration_price || '21', 10)
  const enabled = settings.registration_ln_enabled === 'true'

  // If no LN address configured or not enabled, registration is free
  if (!lnAddress || !enabled) {
    return NextResponse.json({ free: true })
  }

  // Purpose-specific validation. Both registration (primary claim) and
  // wallet-address (secondary claim) mint a bolt11 for a requested username
  // and must fail fast if it's already taken before we hit the provider.
  const mintsAddress =
    body.purpose === 'registration' || body.purpose === 'wallet-address'
  if (mintsAddress) {
    const username = body.metadata?.username
    if (!username) {
      throw new ValidationError('Username is required')
    }

    // Check username availability
    const existing = await prisma.lightningAddress.findUnique({
      where: { username },
    })
    if (existing) {
      throw new ValidationError('Username is already taken')
    }
  }

  // Generate invoice from the platform's lightning address
  const description = mintsAddress
    ? `LaWallet ${body.purpose === 'registration' ? 'registration' : 'address'}: ${body.metadata?.username}`
    : `LaWallet invoice`

  const { bolt11, verify } = await resolveInvoice(lnAddress, price, description)

  // Defense in depth: the save-time probe asserted LUD-21 support, but an
  // upstream provider can regress. Fail closed here instead of letting the
  // client advance to a payment screen that can't detect settlement.
  if (!verify) {
    throw new ValidationError(
      'Payment provider no longer supports LUD-21 verify; registration temporarily unavailable — contact the operator.'
    )
  }

  const paymentHash = extractPaymentHash(bolt11)
  if (!paymentHash) {
    throw new ValidationError('Could not extract payment hash from invoice')
  }

  // Default expiry: 10 minutes
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  // Store in database. The Prisma enum uses SCREAMING_SNAKE_CASE
  // (`REGISTRATION`, `WALLET_ADDRESS`); map the client's kebab-case
  // string once here rather than scattering the conversion around.
  const purposeToEnum = {
    registration: 'REGISTRATION',
    'wallet-address': 'WALLET_ADDRESS',
  } as const
  const invoice = await prisma.invoice.create({
    data: {
      bolt11,
      paymentHash,
      amountSats: price,
      description,
      purpose: purposeToEnum[body.purpose],
      metadata: body.metadata ?? undefined,
      status: 'PENDING',
      userId: user.id,
      expiresAt,
    },
  })

  eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })

  return NextResponse.json({
    id: invoice.id,
    bolt11: invoice.bolt11,
    paymentHash: invoice.paymentHash,
    amountSats: invoice.amountSats,
    verify,
    expiresAt: invoice.expiresAt.toISOString(),
  })
})
