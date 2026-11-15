import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { ConflictError, NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateParams, validateQuery } from '@/lib/validation/middleware'
import { swapIdParam, swapReceiptQuerySchema } from '@/lib/validation/schemas'
import { getIntegrationConfig } from '@/lib/integrations/server'
import { getBullOrderSummary } from '@/lib/integrations/bullbitcoin'
import { lookupAlias } from '@/lib/integrations/alias'
import { buildBullReceiptPdf } from '@/lib/integrations/receipt-pdf'
import { extractPaymentHash } from '@/lib/invoice-utils'
import { createLogger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const log = createLogger({ module: 'integrations:receipt' })

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/wallet/swaps/[id]/receipt — PDF transfer receipt for a completed
 * Bull Bitcoin swap (Bull Bitcoin sends none; Wapu swaps carry Wapu's own
 * `receiptUrl`). Issued by LaWallet from Bull Bitcoin's live order summary;
 * if Bull Bitcoin or the alias lookup is unreachable the receipt is still
 * produced from the stored order.
 */
export const GET = withErrorHandling(async (request: Request, ctx: Ctx) => {
  await rateLimit(request, RateLimitPresets.auth)
  const { pubkey } = await authenticate(request)
  const { id } = validateParams(await ctx.params, swapIdParam)
  const { variant } = validateQuery(request.url, swapReceiptQuerySchema)
  const account = await resolveAccountByPubkey(pubkey)
  if (!account) throw new NotFoundError('Swap not found')
  const swap = await prisma.swap.findFirst({
    where: { id, userId: account.id }
  })
  if (!swap) throw new NotFoundError('Swap not found')
  if (swap.provider !== 'bullbitcoin') {
    throw new NotFoundError('Receipts are generated for Bull Bitcoin swaps')
  }
  if (swap.status !== 'COMPLETED') {
    throw new ConflictError(
      'The receipt is available once the transfer completes'
    )
  }

  const [order, bank] = await Promise.all([
    getIntegrationConfig('bullbitcoin')
      .then(cfg =>
        cfg.configured
          ? getBullOrderSummary(cfg.values.bullbitcoin_api_key, swap.externalId)
          : null
      )
      .catch(err => {
        log.warn(
          { swapId: swap.id, err: (err as Error).message },
          'receipt.order_summary_failed'
        )
        return null
      }),
    getIntegrationConfig('alias')
      .then(cfg =>
        cfg.enabled && cfg.configured
          ? lookupAlias(cfg.values.alias_api_url, swap.destination)
          : null
      )
      .catch(() => null)
  ])

  const pdf = await buildBullReceiptPdf(
    {
      swapId: swap.id,
      externalId: swap.externalId,
      amountArs: Number(swap.amountArs),
      amountSats: swap.amountSats,
      createdAt: swap.createdAt,
      paidAt: swap.paidAt,
      // Bull Bitcoin's own completion time when it reports one.
      completedAt:
        typeof order?.completedAt === 'string' &&
        !Number.isNaN(Date.parse(order.completedAt))
          ? new Date(order.completedAt)
          : swap.updatedAt,
      holderName: swap.holderName ?? bank?.owners[0]?.name ?? null,
      destination: swap.destination,
      account: bank
        ? {
            bank: bank.bank,
            cuit: bank.owners[0]?.cuit ?? null,
            alias: bank.alias,
            cvu: bank.cvu
          }
        : null,
      paymentHash: extractPaymentHash(swap.bolt11),
      order,
      generatedAt: new Date()
    },
    variant
  )

  const orderRef = String(order?.orderNumber ?? swap.externalId).replace(
    /[^\w-]/g,
    ''
  )
  return new Response(Buffer.from(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="comprobante-${variant === 'share' ? '' : 'bullbitcoin-'}${orderRef}.pdf"`,
      'cache-control': 'private, no-store'
    }
  })
})
