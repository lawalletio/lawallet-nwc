import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { McpToolError, type McpCaller } from '@/lib/mcp/types'
import type { CatalogOperation } from '@/lib/mcp/catalog'

/**
 * Per-connection wallet access. The user picks, on the consent screen or
 * under Connected apps, which wallets an OAuth client may use
 * (`OAuthGrant.walletIds`). Every other wallet must look missing to that
 * client: the native wallet tools check it in `resolveWallet`, and the REST
 * operations dispatched under `/api/remote-wallets` are guarded here.
 */

const WALLET_PATH = '/api/remote-wallets/{id}'

/** True when `caller` may use wallet `walletId`. Callers without a grant restriction may use all. */
export function canUseWallet(caller: McpCaller, walletId: string): boolean {
  const allowed = caller.grant?.walletIds
  return !allowed || allowed.includes(walletId)
}

export function walletNotFound(walletId: string): McpToolError {
  return new McpToolError(
    `Wallet ${walletId} not found. Call list_wallets to see the wallets this connection can use.`
  )
}

/**
 * Refuses a REST operation on a wallet the connection was not given, before
 * it is dispatched. Reports it as missing, like REST does for another
 * account's wallet.
 *
 * @throws {McpToolError}
 */
export function guardWalletOperation(
  op: CatalogOperation,
  args: Record<string, unknown>,
  caller: McpCaller
): void {
  if (!caller.grant?.walletIds) return
  if (op.path !== WALLET_PATH && !op.path.startsWith(`${WALLET_PATH}/`)) return
  const id = String(args.id ?? '')
  if (!canUseWallet(caller, id)) throw walletNotFound(id)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrows a successful REST result to the connection's wallets, and lets the
 * connection use a wallet it created itself.
 */
export async function scopeWalletResult(
  op: CatalogOperation,
  body: unknown,
  caller: McpCaller
): Promise<unknown> {
  const grant = caller.grant
  if (!grant?.walletIds) return body
  const allowed = (id: unknown) =>
    typeof id === 'string' && canUseWallet(caller, id)

  if (op.method === 'GET' && op.path === '/api/remote-wallets') {
    return Array.isArray(body)
      ? body.filter(wallet => isRecord(wallet) && allowed(wallet.id))
      : body
  }
  if (op.path === '/api/remote-wallets/forwarding-map' && isRecord(body)) {
    return Array.isArray(body.actions)
      ? {
          ...body,
          actions: body.actions.filter(
            action => isRecord(action) && allowed(action.walletId)
          )
        }
      : body
  }
  if (
    op.method === 'POST' &&
    op.path === '/api/remote-wallets/lncurl' &&
    isRecord(body) &&
    typeof body.id === 'string'
  ) {
    // A wallet the app created is one it can use. The array push is atomic,
    // and `allWallets: false` keeps it off a grant the user just widened.
    await prisma.oAuthGrant
      .updateMany({
        where: { id: grant.id, allWallets: false, revokedAt: null },
        data: { walletIds: { push: body.id } }
      })
      .catch(err => logger.warn({ err }, 'mcp.wallet_access_add_failed'))
    grant.walletIds = [...grant.walletIds, body.id]
  }
  // Any other result that points at a wallet (addresses, cards…): drop the
  // reference to one the connection was not given.
  return hideWalletRefs(body, allowed)
}

/** Fields REST results use to point at a RemoteWallet, and its display name. */
const WALLET_REF = 'remoteWalletId'
const WALLET_NAME = 'remoteWalletName'

/**
 * Deep copy of `value` where every `remoteWalletId` the connection may not
 * use (and its `remoteWalletName`) reads null, as if nothing were bound.
 * Generic on purpose, so new routes are covered without a special case here.
 */
export function hideWalletRefs(
  value: unknown,
  allowed: (id: unknown) => boolean
): unknown {
  if (Array.isArray(value)) return value.map(v => hideWalletRefs(v, allowed))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    out[key] = hideWalletRefs(v, allowed)
  }
  if (typeof out[WALLET_REF] === 'string' && !allowed(out[WALLET_REF])) {
    out[WALLET_REF] = null
    if (WALLET_NAME in out) out[WALLET_NAME] = null
  }
  return out
}

/**
 * The wallet a tool uses when none is named and the account's primary wallet
 * is not one the connection was given: the oldest active selected wallet.
 */
export function firstAllowedWallet(caller: McpCaller, userId: string) {
  const ids = caller.grant?.walletIds
  if (!ids?.length) return Promise.resolve(null)
  return prisma.remoteWallet.findFirst({
    where: { id: { in: ids }, userId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' }
  })
}
