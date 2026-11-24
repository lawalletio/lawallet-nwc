import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountId } from '@/lib/auth/account'
import { toRemoteWalletDto } from '@/lib/remote-wallets/dto'
import { fromWireCustody } from '@/lib/remote-wallets/custody'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import {
  createRemoteWalletSchema,
  remoteWalletListQuerySchema
} from '@/lib/validation/schemas'
import { validateBody, validateQuery } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { resolveNwcModeForCreate } from '@/lib/wallet/nwc-send-capability'
import { getDriver } from '@/lib/wallet/drivers'
import { eventBus } from '@/lib/events/event-bus'
import type { Prisma, RemoteWalletStatus } from '@/lib/generated/prisma'
import {
  bindPrimaryAddressToWallet,
  syncPrimaryRemoteWalletFlag
} from '@/lib/wallet/primary-wallet'
import { encryptRemoteWalletConfig } from '@/lib/wallet/remote-wallet-vault'

const HIDDEN_STATUSES: RemoteWalletStatus[] = ['REVOKED', 'DEAD']

export const dynamic = 'force-dynamic'
export const revalidate = 0

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

  const rows = await prisma.remoteWallet.findMany({
    where: {
      userId,
      // Default: anything except the terminal/hidden states (REVOKED manual
      // soft-delete, DEAD archived disposable wallet) so the UI shows ACTIVE +
      // DISABLED. The archived "graveyard" is fetched via `?status=DEAD`.
      status: query.status ?? { notIn: HIDDEN_STATUSES },
      ...(query.type ? { type: query.type } : {})
    },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
  })

  return NextResponse.json(rows.map(toRemoteWalletDto))
})

/**
 * `POST /api/remote-wallets` — create a new wallet for the caller.
 *
 * `custody` (default `both`) says whether the credentials may be handed back
 * to the client later; `backend` means never.
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
      issues: parsedConfig.error.issues
    })
  }

  // The client sends its own capability probe result, but that probe is a
  // debounced browser relay round-trip that silently falls back to RECEIVE when
  // it doesn't finish — which permanently blocks card spends from a wallet that
  // can pay. Confirm it against the wallet before storing.
  let configToStore: unknown = parsedConfig.data
  if (body.type === 'NWC') {
    const nwcConfig = parsedConfig.data as {
      connectionString: string
      mode: 'RECEIVE' | 'SEND_RECEIVE'
    }
    configToStore = {
      ...nwcConfig,
      mode: await resolveNwcModeForCreate(
        nwcConfig.connectionString,
        nwcConfig.mode
      )
    }
  }

  const walletId = randomUUID()
  const storedConfig = encryptRemoteWalletConfig(
    walletId,
    body.type,
    configToStore
  )

  try {
    const { created, boundPrimaryAddress } = await prisma.$transaction(
      async tx => {
        const created = await tx.remoteWallet.create({
          data: {
            id: walletId,
            userId,
            name: body.name,
            type: body.type,
            // Persist the *parsed* config (defaults applied) so reads are
            // stable. Cast to Prisma input type — Zod schemas always return
            // JSON-serialisable shapes for our drivers.
            config: storedConfig as Prisma.InputJsonValue,
            nwcConfigEncryptedAt: body.type === 'NWC' ? new Date() : undefined,
            // `backend` keeps the credentials on the instance for good: no
            // endpoint will hand the connection string back out.
            custody: fromWireCustody(body.custody),
            isDefault: false
          }
        })

        const boundPrimaryAddress = body.isDefault
          ? await bindPrimaryAddressToWallet(userId, created.id, tx)
          : null

        if (!boundPrimaryAddress) {
          await syncPrimaryRemoteWalletFlag(userId, tx)
        }

        return { created, boundPrimaryAddress }
      }
    )

    // The listener dashboard tracks NWC connections live — nudge it to
    // refetch (the listener itself reconciles via the Postgres trigger).
    eventBus.emit({ type: 'listener:updated', timestamp: Date.now() })
    if (boundPrimaryAddress) {
      eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
      eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
    }

    return NextResponse.json(
      toRemoteWalletDto({
        ...created,
        isDefault: Boolean(boundPrimaryAddress)
      }),
      { status: 201 }
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
