import { NextRequest, NextResponse } from 'next/server'
import { decode } from 'light-bolt11-decoder'
import { prisma } from '@/lib/prisma'
import { getSettings } from '@/lib/settings'
import { withErrorHandling } from '@/types/server/error-handler'
import { ValidationError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { validateBody } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { createInvoiceSchema } from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'

export const dynamic = 'force-dynamic'

/**
 * Resolves a Lightning Address via LUD-16 and generates an invoice.
 * Returns the bolt11 invoice string and optional LUD-21 verify URL.
 */
async function resolveInvoice(
  lightningAddress: string,
  amountSats: number,
  description: string
): Promise<{ bolt11: string; verify?: string }> {
  const [username, domain] = lightningAddress.split('@')
  if (!username || !domain) {
    throw new ValidationError('Invalid lightning address format')
  }

  // Step 1: Fetch LUD-16 metadata
  const metadataUrl = `https://${domain}/.well-known/lnurlp/${username}`
  const metadataRes = await fetch(metadataUrl)
  if (!metadataRes.ok) {
    throw new ValidationError(
      `Failed to resolve lightning address: ${metadataRes.status}`
    )
  }

  const metadata = await metadataRes.json()
  if (metadata.tag !== 'payRequest' || !metadata.callback) {
    throw new ValidationError('Invalid LUD-16 response from lightning address')
  }

  // Step 2: Validate amount
  const amountMsats = amountSats * 1000
  if (amountMsats < metadata.minSendable || amountMsats > metadata.maxSendable) {
    throw new ValidationError(
      `Amount ${amountSats} sats is outside the allowed range`
    )
  }

  // Step 3: Call the callback to get an invoice
  const separator = metadata.callback.includes('?') ? '&' : '?'
  const callbackUrl = `${metadata.callback}${separator}amount=${amountMsats}&comment=${encodeURIComponent(description)}`
  const callbackRes = await fetch(callbackUrl)
  if (!callbackRes.ok) {
    throw new ValidationError(
      `Failed to generate invoice: ${callbackRes.status}`
    )
  }

  const callbackData = await callbackRes.json()
  if (callbackData.status === 'ERROR') {
    throw new ValidationError(
      `Invoice generation failed: ${callbackData.reason}`
    )
  }

  if (!callbackData.pr) {
    throw new ValidationError('No payment request returned')
  }

  return {
    bolt11: callbackData.pr,
    verify: callbackData.verify,
  }
}

/**
 * Extracts the payment hash from a bolt11 invoice string.
 */
function extractPaymentHash(bolt11: string): string {
  const decoded = decode(bolt11)
  const hashSection = decoded.sections.find(
    (s) => s.name === 'payment_hash'
  )
  if (!hashSection || !('value' in hashSection)) {
    throw new ValidationError('Could not extract payment hash from invoice')
  }
  return hashSection.value as string
}

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

  // Purpose-specific validation
  if (body.purpose === 'registration') {
    const username = body.metadata?.username
    if (!username) {
      throw new ValidationError('Username is required for registration')
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
  const description = body.purpose === 'registration'
    ? `LaWallet registration: ${body.metadata?.username}`
    : `LaWallet invoice`

  const { bolt11, verify } = await resolveInvoice(lnAddress, price, description)
  const paymentHash = extractPaymentHash(bolt11)

  // Default expiry: 10 minutes
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  // Store in database
  const invoice = await prisma.invoice.create({
    data: {
      bolt11,
      paymentHash,
      amountSats: price,
      description,
      purpose: body.purpose.toUpperCase() as 'REGISTRATION',
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
