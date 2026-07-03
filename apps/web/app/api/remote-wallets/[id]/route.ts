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
  idParam,
  updateRemoteWalletSchema,
} from '@/lib/validation/schemas'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { eventBus } from '@/lib/events/event-bus'
import type { RemoteWallet, RemoteWalletStatus } from '@/lib/generated/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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
 * Load a wallet **scoped to the caller**. Returns 404 — not 403 — when the
 * wallet exists but belongs to someone else, so we don't leak the existence
 * of other users' wallet IDs to a casual probe.
 */
async function loadOwnedWallet(walletId: string, userId: string): Promise<RemoteWallet> {
  const wallet = await prisma.remoteWallet.findUnique({ where: { id: walletId } })
  if (!wallet || wallet.userId !== userId) {
    throw new NotFoundError('Wallet not found')
  }
  return wallet
}

/**
 * `GET /api/remote-wallets/[id]` — fetch a single wallet by id, scoped to
 * the caller. `config` is intentionally omitted from the response; the
 * connection URI is a secret and lives behind a future reveal endpoint.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await authenticate(request)
    const userId = await resolveUserId(auth.pubkey)

    const { id } = validateParams(await params, idParam)
    const wallet = await loadOwnedWallet(id, userId)

    return NextResponse.json(toDto(wallet))
  },
)

/**
 * `PATCH /api/remote-wallets/[id]` — rename, flip default, or change status.
 *
 *  - Renaming hits the `(userId, name)` unique index → 409 on collision.
 *  - Setting `isDefault: true` un-marks the previous default in the same
 *    transaction so the partial unique index can't race.
 *  - Status is a simple enum write — we deliberately don't enforce
 *    "REVOKED is terminal" at the API layer; the UI is the right place to
 *    hide that affordance, and tests/admins benefit from the freedom.
 */
export const PATCH = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')

    const auth = await authenticate(request)
    const userId = await resolveUserId(auth.pubkey)

    const { id } = validateParams(await params, idParam)
    const body = await validateBody(request, updateRemoteWalletSchema)

    // Ownership check up front so a 404 fires before any writes.
    await loadOwnedWallet(id, userId)

    try {
      const updated = await prisma.$transaction(async tx => {
        if (body.isDefault === true) {
          await tx.remoteWallet.updateMany({
            where: { userId, isDefault: true, NOT: { id } },
            data: { isDefault: false },
          })
        }

        return tx.remoteWallet.update({
          where: { id },
          data: {
            name: body.name,
            isDefault: body.isDefault,
            status: body.status,
          },
        })
      })

      // Status/name flips change what the listener dashboard shows — nudge
      // it to refetch (the listener reconciles via the Postgres trigger).
      eventBus.emit({ type: 'listener:updated', timestamp: Date.now() })

      return NextResponse.json(toDto(updated))
    } catch (err) {
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
  },
)

/**
 * `DELETE /api/remote-wallets/[id]` — by default a **soft delete** that flips
 * status to `REVOKED` and keeps the row for audit (both `Card.remoteWalletId`
 * and `LightningAddress.remoteWalletId` are `onDelete: SetNull`).
 *
 * `?permanent=true` performs a **hard delete** — used to clear an archived
 * (DEAD) or otherwise retired wallet out of the list for good. It's refused
 * for ACTIVE wallets so we never drop a live wallet (and its bindings) without
 * first retiring it; the SetNull relations make the row drop itself safe.
 *
 * Either way, `isDefault` is implicitly cleared (soft via the update, hard via
 * the row removal) so a stale flag can't resurrect a dead default slot.
 */
export const DELETE = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const auth = await authenticate(request)
    const userId = await resolveUserId(auth.pubkey)

    const { id } = validateParams(await params, idParam)
    const wallet = await loadOwnedWallet(id, userId)

    const permanent =
      new URL(request.url).searchParams.get('permanent') === 'true'

    if (permanent) {
      if (wallet.status === 'ACTIVE') {
        throw new ValidationError(
          'Disable or delete the wallet before removing it permanently',
        )
      }
      await prisma.remoteWallet.delete({ where: { id } })
      eventBus.emit({ type: 'listener:updated', timestamp: Date.now() })
      return new NextResponse(null, { status: 204 })
    }

    await prisma.remoteWallet.update({
      where: { id },
      data: { status: 'REVOKED', isDefault: false },
    })

    eventBus.emit({ type: 'listener:updated', timestamp: Date.now() })
    return new NextResponse(null, { status: 204 })
  },
)
