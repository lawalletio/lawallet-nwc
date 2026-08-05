import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * How many times a payment may be forwarded through this instance before we
 * stop. Forwarding to a local address is allowed, so `a -> b -> a` is a
 * configuration the owner can express (directly, or indirectly through a ring
 * that crosses the proxy and RemoteWallet subsystems). Config-time cycle
 * detection rejects the rings it can see; this is the backstop that holds when
 * it cannot — concurrent edits that race a cycle into existence, a restored
 * backup, or an edge added after the fact.
 */
export const MAX_FORWARD_HOPS = 3

export const FORWARD_HOP_LIMIT_ERROR =
  'Forwarding hop limit reached: this payment has already been forwarded ' +
  `${MAX_FORWARD_HOPS} times within this instance`

/**
 * Depth of the payment that funded us, or 0 when it did not originate from a
 * local forward. Read by the *paying* side before it forwards onward, so the
 * chain is cut before another invoice is minted.
 */
export async function getForwardDepth(
  paymentHash: string | null | undefined
): Promise<number> {
  if (!paymentHash) return 0
  const hop = await prisma.forwardingHop.findUnique({
    where: { paymentHash },
    select: { depth: true }
  })
  return hop?.depth ?? 0
}

export function isForwardDepthExhausted(depth: number): boolean {
  return depth >= MAX_FORWARD_HOPS
}

/**
 * Stamps the destination invoice we are about to pay. Only called for
 * destinations on this instance — a payment leaving for another service can
 * never come back as a local forward, so there is nothing to count.
 *
 * Best-effort by design: losing the marker must not fail an otherwise valid
 * payment. A lost marker restarts the count for that branch, which the
 * config-time cycle check is there to make unreachable.
 */
export async function recordForwardHop(
  paymentHash: string,
  depth: number
): Promise<void> {
  try {
    await prisma.forwardingHop.upsert({
      where: { paymentHash },
      create: { paymentHash, depth },
      update: { depth }
    })
  } catch (error) {
    logger.warn(
      { paymentHash, depth, err: error },
      'forwarding hop marker could not be recorded'
    )
  }
}
