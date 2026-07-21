import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountId } from '@/lib/auth/account'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/types/server/errors'
import {
  createRemoteWalletSchema,
  remoteWalletListQuerySchema,
} from '@/lib/validation/schemas'
import { validateBody, validateQuery } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { getDriver } from '@/lib/wallet/drivers'
import { eventBus } from '@/lib/events/event-bus'
import type { RemoteWallet, RemoteWalletStatus } from '@/lib/generated/prisma'
import {
  bindPrimaryAddressToWallet,
  syncPrimaryRemoteWalletFlag,
} from '@/lib/wallet/primary-wallet'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Wire shape returned to the UI. Deliberately **omits** `config` and
 * `userId` — `config` carries secrets (NWC URI) and `userId` is implicit
 * from the authenticated caller. Reveal endpoints live separately.
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
  const userId = await resolveAccountId(pubkey)
  // The unified-auth flow upserts a User row before we get here, so a miss
  // would mean someone deleted the row mid-request. Surface as a 404 rather
  // than crashing with a Prisma `userId` violation downstream.
  if (!userId) throw new NotFoundError('User not found')
  return userId
}

/**
 * `GET /api/remote-wallets` — list the caller's wallets.
 *
 * Hides the terminal states — REVOKED (manual soft-delete) and DEAD (archived
 * disposable wallet) — by default; pass `?status=REVOKED` or `?status=DEAD`
 * to fetch them (the latter powers the archived "graveyard"). `?type=NWC`
 * narrows by driver type — the "add wallet" picker uses this to preview which
 * driver types are available.
 *
 * Ordering: synchronized primary wallet first, then by creation date desc.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const auth = await authenticate(request)
  const userId = await resolveUserId(auth.pubkey)

  const query = validateQuery(request.url, remoteWalletListQuerySchema)

  const where: { userId: string; status?: RemoteWalletStatus; type?: RemoteWallet['type'] } = {
    userId,
  }
  if (query.status) {
    where.status = query.status
  } else {
    // Default: anything except the terminal/hidden states (REVOKED manual
    // soft-delete, DEAD archived disposable wallet) so the UI shows ACTIVE +
    // DISABLED. The archived "graveyard" is fetched explicitly via
    // `?status=DEAD`. Prisma doesn't let us inline `NOT IN (...)` cleanly
    // without a typed workaround, so we fall through and filter in memory.
  }
  if (query.type) where.type = query.type

  const rows = await prisma.remoteWallet.findMany({
    where,
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  })

  const filtered = query.status
    ? rows
    : rows.filter(r => r.status !== 'REVOKED' && r.status !== 'DEAD')

  return NextResponse.json(filtered.map(toDto))
})

/**
 * `POST /api/remote-wallets` — create a new wallet for the caller.
 *
 * Validates the body envelope here, then hands `config` to the driver
 * registry's per-type schema so each driver owns its own shape. The whole
 * write happens in a transaction. `isDefault=true` is accepted as a
 * compatibility shortcut: when the user has a primary Lightning Address, the
 * new wallet is bound to that address and the display flag is synchronized
 * from that binding. Without a primary address, the wallet is created without
 * a primary flag.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')

  const auth = await authenticate(request)
  const userId = await resolveUserId(auth.pubkey)

  const body = await validateBody(request, createRemoteWalletSchema)

  // Run the user-supplied `config` through the driver's schema so type-NWC
  // wallets get NWC config validation, type-LND would get LND, etc. The
  // driver owns this knowledge — the API layer just dispatches.
  const driver = getDriver(body.type)
  const parsedConfig = driver.configSchema.safeParse(body.config)
  if (!parsedConfig.success) {
    throw new ValidationError('Invalid wallet config', {
      issues: parsedConfig.error.issues,
    })
  }

  try {
    const { created, boundPrimaryAddress } = await prisma.$transaction(async tx => {
      const created = await tx.remoteWallet.create({
        data: {
          userId,
          name: body.name,
          type: body.type,
          // Persist the *parsed* config (defaults applied) so reads are
          // stable. Cast to Prisma input type — Zod schemas always return
          // JSON-serialisable shapes for our drivers.
          config: parsedConfig.data as object,
          isDefault: false,
        },
      })

      const boundPrimaryAddress = body.isDefault
        ? await bindPrimaryAddressToWallet(userId, created.id, tx)
        : null

      if (!boundPrimaryAddress) {
        await syncPrimaryRemoteWalletFlag(userId, tx)
      }

      return { created, boundPrimaryAddress }
    })

    // The listener dashboard tracks NWC connections live — nudge it to
    // refetch (the listener itself reconciles via the Postgres trigger).
    eventBus.emit({ type: 'listener:updated', timestamp: Date.now() })
    if (boundPrimaryAddress) {
      eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
      eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
    }

    return NextResponse.json(
      toDto({ ...created, isDefault: Boolean(boundPrimaryAddress) }),
      { status: 201 },
    )
  } catch (err) {
    // Prisma maps the `(userId, name)` unique index to P2002. Surface as a
    // 409 so the UI can prompt for a different name without parsing error
    // strings.
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
