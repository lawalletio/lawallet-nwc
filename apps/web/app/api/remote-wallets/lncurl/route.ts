import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { getSettings } from '@/lib/settings'
import { createLncurlRemoteWallet } from '@/lib/wallet/lncurl-wallet'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '@/types/server/errors'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody } from '@/lib/validation/middleware'
import { createLncurlWalletSchema } from '@/lib/validation/schemas'
import { logger } from '@/lib/logger'
import { eventBus } from '@/lib/events/event-bus'
import type { RemoteWallet, RemoteWalletStatus } from '@/lib/generated/prisma'
import { bindPrimaryAddressToWallet } from '@/lib/wallet/primary-wallet'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Wire shape returned to the UI — same envelope as `/api/remote-wallets`.
 * Deliberately omits `config` (carries the NWC URI) and `userId`.
 */
interface RemoteWalletDto {
  id: string
  name: string
  type: RemoteWallet['type']
  status: RemoteWalletStatus
  isDefault: boolean
  createdAt: string
  updatedAt: string
  /** Set only for archived (DEAD) wallets — when the wallet was detected dead. */
  diedAt: string | null
  /** `'lncurl'` for a disposable LNCurl-provisioned wallet, else null. Drives the UI tag + countdown. */
  provider: 'lncurl' | null
  /** For LNCurl wallets, the server that minted THIS wallet (stored per-wallet, so a later settings change doesn't move it). Null otherwise. */
  lncurlServerUrl: string | null
}

function toDto(w: RemoteWallet): RemoteWalletDto {
  const cfg = w.config as { provider?: unknown; lncurlServerUrl?: unknown } | null
  const isLncurl = cfg?.provider === 'lncurl'
  return {
    id: w.id,
    name: w.name,
    type: w.type,
    status: w.status,
    isDefault: w.isDefault,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
    diedAt: w.diedAt ? w.diedAt.toISOString() : null,
    provider: isLncurl ? 'lncurl' : null,
    lncurlServerUrl:
      isLncurl && typeof cfg?.lncurlServerUrl === 'string' ? cfg.lncurlServerUrl : null,
  }
}

async function resolveUserId(pubkey: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { pubkey },
    select: { id: true },
  })
  if (!user) throw new NotFoundError('User not found')
  return user.id
}

/**
 * `POST /api/remote-wallets/lncurl` — provision a fresh LNCurl custodial wallet.
 * `isDefault=true` is accepted as a compatibility shortcut: when the caller
 * already has a primary Lightning Address, bind that address to the new wallet
 * so it becomes the account primary wallet under the primary-address rule.
 *
 * Gated behind the `lncurl_enabled` setting. Network/provider failures surface
 * as a 503 (an upstream dependency being unavailable, not a bug here).
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')

  const auth = await authenticate(request)
  const userId = await resolveUserId(auth.pubkey)

  const { lncurl_enabled, lncurl_server_url } = await getSettings([
    'lncurl_enabled',
    'lncurl_server_url',
  ])

  if (lncurl_enabled !== 'true') {
    throw new ValidationError('LNCurl is not enabled')
  }

  const { name, isDefault } = await validateBody(request, createLncurlWalletSchema)

  try {
    const created = await createLncurlRemoteWallet({
      userId,
      name: name || undefined,
      revokePrevious: false,
      serverUrl: lncurl_server_url || undefined,
    })

    const boundPrimaryAddress = isDefault
      ? await bindPrimaryAddressToWallet(userId, created.id)
      : null
    if (boundPrimaryAddress) {
      eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
      eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
    }

    return NextResponse.json(
      toDto({ ...created, isDefault: Boolean(boundPrimaryAddress) }),
      { status: 201 },
    )
  } catch (err) {
    logger.error({ userId, err: String(err) }, 'LNCurl provisioning failed')
    throw new ServiceUnavailableError('Could not provision an LNCurl wallet')
  }
})
