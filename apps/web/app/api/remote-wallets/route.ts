import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
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
import type { RemoteWallet, RemoteWalletStatus } from '@/lib/generated/prisma'

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
}

function toDto(w: RemoteWallet): RemoteWalletDto {
  return {
    id: w.id,
    name: w.name,
    type: w.type,
    status: w.status,
    isDefault: w.isDefault,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  }
}

async function resolveUserId(pubkey: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { pubkey },
    select: { id: true },
  })
  // The unified-auth flow upserts a User row before we get here, so a miss
  // would mean someone deleted the row mid-request. Surface as a 404 rather
  // than crashing with a Prisma `userId` violation downstream.
  if (!user) throw new NotFoundError('User not found')
  return user.id
}

/**
 * `GET /api/remote-wallets` — list the caller's wallets.
 *
 * Hides REVOKED rows by default (the UI typically doesn't want to render
 * dead wallets); pass `?status=REVOKED` to get them. `?type=NWC` narrows by
 * driver type — the upcoming "add wallet" picker uses this to preview which
 * driver types are available.
 *
 * Default ordering: default wallet first, then by creation date desc.
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
    // Default: anything except REVOKED so the UI shows ACTIVE + DISABLED.
    // Prisma doesn't let us inline `NOT REVOKED` cleanly without a typed
    // workaround, so we fall through and filter REVOKED in memory if the
    // list ever grows past a handful. For now keep it simple.
  }
  if (query.type) where.type = query.type

  const rows = await prisma.remoteWallet.findMany({
    where,
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  })

  const filtered = query.status ? rows : rows.filter(r => r.status !== 'REVOKED')

  return NextResponse.json(filtered.map(toDto))
})

/**
 * `POST /api/remote-wallets` — create a new wallet for the caller.
 *
 * Validates the body envelope here, then hands `config` to the driver
 * registry's per-type schema so each driver owns its own shape. The whole
 * write happens in a transaction so the default-flip is atomic with the
 * insert.
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
    const created = await prisma.$transaction(async tx => {
      if (body.isDefault) {
        // Clear any existing default before flipping the new row — the
        // partial unique index `RemoteWallet_userId_default_unique` would
        // otherwise raise a 23505 on the insert.
        await tx.remoteWallet.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        })
      }

      return tx.remoteWallet.create({
        data: {
          userId,
          name: body.name,
          type: body.type,
          // Persist the *parsed* config (defaults applied) so reads are
          // stable. Cast to Prisma input type — Zod schemas always return
          // JSON-serialisable shapes for our drivers.
          config: parsedConfig.data as object,
          isDefault: body.isDefault ?? false,
        },
      })
    })

    return NextResponse.json(toDto(created), { status: 201 })
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
