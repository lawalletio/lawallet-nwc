import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { isIP } from 'node:net'
import {
  createPinnedLookup,
  isPrivateNetworkAddress,
  type SafeAddress
} from '@/lib/proxy/lnurl'
import { ServiceUnavailableError, ValidationError } from '@/types/server/errors'
import { voucherTransferResponseSchema } from '@/lib/validation/schemas'
import { allowsInsecureServiceUrls } from '@/lib/vouchers/url'
import { isLocalHost } from '@/lib/public-url-utils'

const TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 32 * 1024

export type DeliveryOutcome =
  | { status: 'ACCEPTED' }
  | { status: 'ERROR'; reason: string }

/**
 * Hand a voucher to a lightning address.
 *
 * Resolves the recipient's LUD-16 payRequest, checks it advertises
 * `allowVouchers`, and POSTs the coupon to the callback **it** named — the
 * recipient's own document is the only acceptable source for that URL.
 *
 * Both hops go through the same resolve-check-pin discipline as every other
 * outbound call in this codebase: the address is user-supplied, so this is an
 * SSRF sink whether or not the payload looks harmless.
 */
export async function deliverVoucher(input: {
  address: string
  nonce: string
  voucherEvent: unknown
  comment?: string
}): Promise<DeliveryOutcome> {
  const [name, host] = input.address.split('@')
  if (!name || !host) {
    throw new ValidationError('Recipient must be a lightning address')
  }
  if (!input.voucherEvent) {
    // Without the signed event the recipient has nothing to verify, and a
    // spec-compliant one will refuse. Fail here with a reason the sender can
    // act on rather than surfacing their refusal.
    throw new ValidationError(
      'This voucher has no signed event, so it cannot be transferred'
    )
  }

  // Scheme follows the *host*, not the environment. Forcing http in dev makes
  // a dev build unable to talk to any real domain: the request meets an
  // https redirect and the body that comes back is not JSON.
  const scheme = isLocalHost(host) ? 'http' : 'https'
  const payRequestUrl = new URL(
    `${scheme}://${host}/.well-known/lnurlp/${encodeURIComponent(name)}`
  )
  const payRequest = (await json(payRequestUrl, 'GET')) as {
    tag?: string
    callback?: string
    allowVouchers?: boolean
  }

  if (payRequest?.tag !== 'payRequest' || !payRequest.callback) {
    throw new ValidationError('Recipient is not a lightning address')
  }
  if (payRequest.allowVouchers !== true) {
    throw new ValidationError('Recipient does not accept vouchers')
  }

  const callback = new URL(payRequest.callback)
  if (callback.protocol !== 'https:' && !isLocalHost(callback.host)) {
    throw new ValidationError('Recipient callback must use https')
  }

  const answer = await json(callback, 'POST', {
    action: 'voucher',
    nonce: input.nonce,
    voucher: input.voucherEvent,
    ...(input.comment ? { comment: input.comment } : {})
  })

  const parsed = voucherTransferResponseSchema.safeParse(answer)
  if (!parsed.success) {
    throw new ServiceUnavailableError(
      'Recipient returned an unrecognized response'
    )
  }
  return parsed.data
}

async function json(
  url: URL,
  method: 'GET' | 'POST',
  payload?: unknown
): Promise<unknown> {
  const pinned = await resolveSafeAddress(url.hostname)
  const body = payload === undefined ? undefined : JSON.stringify(payload)
  const send = url.protocol === 'http:' ? httpRequest : httpsRequest

  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        lookup: createPinnedLookup(pinned),
        headers: {
          accept: 'application/json',
          'user-agent': 'LaWallet-Vouchers/1',
          ...(body
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body)
              }
            : {})
        }
      },
      response => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer | Uint8Array | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += bytes.length
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(new Error('Recipient response is too large'))
            return
          }
          chunks.push(bytes)
        })
        response.once('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(
              new ServiceUnavailableError('Recipient returned invalid JSON')
            )
          }
        })
        response.once('error', reject)
      }
    )
    req.once('error', err =>
      reject(
        err instanceof ServiceUnavailableError
          ? err
          : new ServiceUnavailableError('Could not reach the recipient')
      )
    )
    req.end(body)
  })
}

/** Resolve once, reject private answers, pin the socket to what passed. */
async function resolveSafeAddress(hostname: string): Promise<SafeAddress> {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback =
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')

  // Two instances on one dev machine is the normal way to try this out.
  if (loopback && allowsInsecureServiceUrls()) {
    return { address: '127.0.0.1', family: 4 }
  }
  if (loopback) {
    throw new ServiceUnavailableError(
      'Recipient address resolves to a private network'
    )
  }

  const family = isIP(normalized)
  const addresses: SafeAddress[] = family
    ? [{ address: normalized, family: family as 4 | 6 }]
    : (await lookup(normalized, { all: true, verbatim: true })).map(item => ({
        address: item.address,
        family: item.family as 4 | 6
      }))

  if (addresses.length === 0) {
    throw new ServiceUnavailableError('Recipient address does not resolve')
  }
  if (
    !allowsInsecureServiceUrls() &&
    addresses.some(address => isPrivateNetworkAddress(address.address))
  ) {
    throw new ServiceUnavailableError(
      'Recipient address resolves to a private network'
    )
  }
  return addresses[0]
}
