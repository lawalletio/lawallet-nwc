import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountId } from '@/lib/auth/account'
import { getSettings } from '@/lib/settings'
import type { LncurlWallet } from '@/lib/lncurl'
import {
  createLncurlRemoteWallet,
  mintLncurlWallet
} from '@/lib/wallet/lncurl-wallet'
import { toRemoteWalletDto } from '@/lib/remote-wallets/dto'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError
} from '@/types/server/errors'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody } from '@/lib/validation/middleware'
import { createLncurlWalletSchema } from '@/lib/validation/schemas'
import { logger } from '@/lib/logger'
import { eventBus } from '@/lib/events/event-bus'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function resolveUserId(pubkey: string): Promise<string> {
  const userId = await resolveAccountId(pubkey)
  if (!userId) throw new NotFoundError('User not found')
  return userId
}

/**
 * `POST /api/remote-wallets/lncurl` — provision a fresh LNCurl custodial wallet.
 * `isDefault=true` is accepted as a compatibility shortcut: when the caller
 * already has a primary Lightning Address, bind that address to the new wallet
 * so it becomes the account primary wallet under the primary-address rule.
 *
 * Gated behind the `lncurl_enabled` setting. The mint stays outside the DB
 * write so a provider outage is a 503; create + optional primary bind then
 * run in one transaction (matching `POST /api/remote-wallets`). Local DB
 * errors are not remapped to 503 — only `P2002` becomes 409.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')

  const auth = await authenticate(request)
  const userId = await resolveUserId(auth.pubkey)

  const { lncurl_enabled, lncurl_server_url } = await getSettings([
    'lncurl_enabled',
    'lncurl_server_url'
  ])

  if (lncurl_enabled !== 'true') {
    throw new ValidationError('LNCurl is not enabled')
  }

  const { name, isDefault } = await validateBody(
    request,
    createLncurlWalletSchema
  )

  const serverUrl = lncurl_server_url || undefined

  // Mint first, outside any DB transaction. Genuine upstream failures stay
  // a 503; a later create/bind error must not inherit that mapping.
  let mint: LncurlWallet
  try {
    mint = await mintLncurlWallet(serverUrl)
  } catch (err) {
    logger.error({ userId, err: String(err) }, 'LNCurl provisioning failed')
    throw new ServiceUnavailableError('Could not provision an LNCurl wallet')
  }

  try {
    const created = await createLncurlRemoteWallet({
      userId,
      name: name || undefined,
      revokePrevious: false,
      serverUrl,
      isDefault,
      mint
    })

    if (isDefault && created.isDefault) {
      eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
      eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
    }

    return NextResponse.json(toRemoteWalletDto(created), { status: 201 })
  } catch (err) {
    // Prisma maps the `(userId, name)` unique index to P2002. Surface as a
    // 409 so the UI can prompt for a different name without parsing error
    // strings — same contract as POST /api/remote-wallets.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      throw new ConflictError('A wallet with that name already exists')
    }
    throw err
  }
})
