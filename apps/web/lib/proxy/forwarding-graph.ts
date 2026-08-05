import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/types/server/errors'
import { resolveLocalDestination } from './local-destination'
import { MAX_FORWARD_HOPS } from './forward-hops'

/**
 * A node in the intra-instance forwarding graph. Only local addresses and the
 * wallets they are bound to can form a cycle — once a payment leaves for
 * another service it is no longer ours.
 */
type Node =
  | { kind: 'address'; username: string }
  | { kind: 'wallet'; walletId: string }

/**
 * Edges a payment can travel inside this instance:
 *
 *  - `LightningAddress.redirect` when the mode is PROXY_ALIAS (receive, then
 *    forward). ALIAS is *not* an edge: it hands the payer the destination's own
 *    payRequest, so the funds never touch us.
 *  - `LightningAddress.remoteWalletId` — a payment to the address lands in that
 *    wallet, which may itself have forwarding enabled. This edge is invisible
 *    from the address side, and it is what makes cross-subsystem rings possible.
 *  - `RemoteWalletForwardDestination.address` for a wallet with an enabled
 *    FORWARD action.
 */
async function successors(node: Node): Promise<Node[]> {
  if (node.kind === 'wallet') {
    const action = await prisma.remoteWalletReceiveAction.findUnique({
      where: { remoteWalletId: node.walletId },
      include: { currentRevision: { include: { destinations: true } } }
    })
    if (!action?.enabled || !action.currentRevision) return []
    return localNodes(action.currentRevision.destinations.map(d => d.address))
  }

  const address = await prisma.lightningAddress.findUnique({
    where: { username: node.username },
    select: { mode: true, redirect: true, remoteWalletId: true }
  })
  if (!address) return []
  const next: Node[] = []
  if (address.mode === 'PROXY_ALIAS' && address.redirect) {
    next.push(...(await localNodes([address.redirect])))
  }
  if (address.remoteWalletId) {
    next.push({ kind: 'wallet', walletId: address.remoteWalletId })
  }
  return next
}

/** Keeps only the destinations that stay on this instance. */
async function localNodes(addresses: string[]): Promise<Node[]> {
  const resolved = await Promise.all(
    addresses.map(address => resolveLocalDestination(address))
  )
  return resolved
    .filter((local): local is NonNullable<typeof local> => local !== null)
    .map(local => ({ kind: 'address', username: local.username }) as Node)
}

const key = (node: Node) =>
  node.kind === 'wallet' ? `wallet:${node.walletId}` : `address:${node.username}`

/**
 * Rejects a destination that would let a payment arriving at `from` reach
 * `from` again. Walks forward from the proposed destination; if the walk gets
 * back to the origin the configuration is a cycle.
 *
 * Every route that writes a forwarding edge calls this, so no single write can
 * complete a ring. Two concurrent writes can still race one into existence,
 * which is why {@link MAX_FORWARD_HOPS} exists as the runtime backstop.
 */
export async function assertNoForwardingCycle(
  from: Node,
  destination: string
): Promise<void> {
  const target = await resolveLocalDestination(destination)
  if (!target) return // leaves this instance — cannot come back

  const origin = key(from)
  const start: Node = { kind: 'address', username: target.username }

  if (key(start) === origin) {
    throw new ValidationError(
      `Forwarding destination would loop back to itself: ${destination}`
    )
  }

  const seen = new Set<string>()
  const queue: Node[] = [start]
  while (queue.length > 0) {
    const node = queue.shift()!
    if (seen.has(key(node))) continue
    seen.add(key(node))
    if (key(node) === origin) {
      throw new ValidationError(
        `Forwarding destination would create a payment loop: paying ` +
          `${destination} eventually pays the source again`
      )
    }
    queue.push(...(await successors(node)))
  }
}

export const forwardingGraphNodes = {
  address: (username: string): Node => ({ kind: 'address', username }),
  wallet: (walletId: string): Node => ({ kind: 'wallet', walletId })
}
