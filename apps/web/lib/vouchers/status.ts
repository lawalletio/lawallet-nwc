import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { isIP } from 'node:net'
import {
  createPinnedLookup,
  isPrivateNetworkAddress,
  type SafeAddress
} from '@/lib/proxy/lnurl'
import {
  couponClaimPreviewSchema,
  couponRefreshResponseSchema
} from '@/lib/validation/schemas'
import type { VoucherStatus } from '@/lib/validation/schemas'
import { ServiceUnavailableError } from '@/types/server/errors'
import { voucherStatusFromService } from '@/lib/vouchers/transition'
import { allowsInsecureServiceUrls, assertServiceUrl } from '@/lib/vouchers/url'

const TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 64 * 1024

export interface VoucherStatusReport {
  /** Null when the service reported a status this build doesn't recognise. */
  status: VoucherStatus | null
  claimedAt: Date | null
  expiresAt: Date | null
}

/**
 * Poll a coupon-manager service for a voucher's current status.
 *
 * Uses the protocol's `GET {claimUrl}?nonce=` preview, which is public,
 * non-consuming, and returns `200` with a `status` field for any known nonce
 * — so a `404` here means the service does not know the code, not that it is
 * spent.
 *
 * The URL comes from a third party stored in our database, which makes this a
 * textbook SSRF sink. It goes through the same resolve-check-pin dance as
 * outbound notification webhooks (`lib/remote-wallet-notifications/webhook.ts`)
 * rather than a bare `fetch`.
 */
export async function fetchVoucherStatus(input: {
  claimUrl: string
  nonce: string
}): Promise<VoucherStatusReport> {
  const url = assertServiceUrl(input.claimUrl, 'claimUrl')
  // The nonce is a bearer token. It has to ride in the query string because
  // that is what the protocol specifies; it must never reach a log.
  url.searchParams.set('nonce', input.nonce)

  const pinned = await resolveSafeAddress(url.hostname)
  const body = await get(url, pinned)
  const parsed = couponClaimPreviewSchema.safeParse(body)
  if (!parsed.success) {
    throw new ServiceUnavailableError(
      'Coupon service returned an unrecognized response'
    )
  }

  return {
    status: voucherStatusFromService(parsed.data.status),
    claimedAt: toDate(parsed.data.claimedAt),
    expiresAt: toDate(parsed.data.expiresAt)
  }
}

/** Accepts an ISO string or unix seconds, both of which services emit. */
function toDate(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const date =
    typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function get(url: URL, pinned: SafeAddress): Promise<unknown> {
  return send(url, pinned, 'GET')
}

function send(
  url: URL,
  pinned: SafeAddress,
  method: 'GET' | 'POST',
  payload?: { body: string; idempotencyKey: string }
): Promise<unknown> {
  const request = url.protocol === 'http:' ? httpRequest : httpsRequest
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        lookup: createPinnedLookup(pinned),
        headers: {
          accept: 'application/json',
          'user-agent': 'LaWallet-Vouchers/1',
          ...(payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload.body),
                'idempotency-key': payload.idempotencyKey
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
            response.destroy(new Error('Coupon service response is too large'))
            return
          }
          chunks.push(bytes)
        })
        response.once('end', () => {
          const status = response.statusCode ?? 0
          const text = Buffer.concat(chunks).toString('utf8')
          if (status < 200 || status >= 300) {
            reject(
              new ServiceUnavailableError(`Coupon service responded ${status}`)
            )
            return
          }
          try {
            resolve(JSON.parse(text))
          } catch {
            reject(
              new ServiceUnavailableError(
                'Coupon service returned invalid JSON'
              )
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
          : new ServiceUnavailableError('Could not reach the coupon service')
      )
    )
    req.end(payload?.body)
  })
}

export interface RefreshedVoucher {
  nonce: string
  couponId: string | null
  expiresAt: Date | null
  voucher: Record<string, unknown> | null
  /**
   * How the replacement describes itself. Mint-shaped responses carry these;
   * a service that omits them leaves the caller to fall back.
   */
  name: string | null
  description: string | null
  image: string | null
  benefit: unknown
}

/**
 * Swap a nonce for its replacement at the coupon-manager service.
 *
 * This is the one irreversible step in a transfer: it burns the sender's nonce
 * and mints a new one, and the response is the only place that new nonce ever
 * appears. Two consequences the caller must respect — persist the result
 * before acknowledging anything, and pass a stable `idempotencyKey` so a
 * retried call replays instead of burning twice.
 *
 * `refreshUrl` must come from our own record of the service, never from a
 * request body. See `lib/vouchers/transfer.ts`.
 */
export async function refreshVoucherAtService(input: {
  refreshUrl: string
  nonce: string
  idempotencyKey: string
}): Promise<RefreshedVoucher> {
  const url = assertServiceUrl(input.refreshUrl, 'refreshUrl')
  const pinned = await resolveSafeAddress(url.hostname)
  const body = JSON.stringify({ nonce: input.nonce })

  const raw = await send(url, pinned, 'POST', {
    body,
    idempotencyKey: input.idempotencyKey
  })
  const parsed = couponRefreshResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ServiceUnavailableError(
      'Coupon service returned an unrecognized refresh response'
    )
  }
  if (parsed.data.nonce === input.nonce) {
    // A service that hands back the same nonce has not swapped anything.
    // Storing it would leave both sides believing they hold the coupon.
    throw new ServiceUnavailableError(
      'Coupon service did not return a replacement nonce'
    )
  }

  return {
    nonce: parsed.data.nonce,
    couponId: parsed.data.couponId ?? null,
    expiresAt: toDate(parsed.data.expiresAt),
    voucher: (parsed.data.voucher as Record<string, unknown>) ?? null,
    name: parsed.data.name ?? null,
    description: parsed.data.description ?? null,
    image: parsed.data.image ?? null,
    benefit: parsed.data.coupon ?? null
  }
}

/**
 * Resolve once, reject every private answer, then pin the socket to the
 * address that passed. Closes the resolve-check-fetch rebinding gap while
 * keeping TLS hostname validation intact for the original host.
 */
async function resolveSafeAddress(hostname: string): Promise<SafeAddress> {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback =
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')

  // Dev instances point `claimUrl` at a service on the same machine. That is
  // the one case where a private answer is expected rather than an attack.
  if (loopback && allowsInsecureServiceUrls()) {
    return { address: '127.0.0.1', family: 4 }
  }
  if (loopback) {
    throw new ServiceUnavailableError(
      'Coupon service URL resolves to a private network'
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
    throw new ServiceUnavailableError('Coupon service URL does not resolve')
  }
  if (
    !allowsInsecureServiceUrls() &&
    addresses.some(address => isPrivateNetworkAddress(address.address))
  ) {
    throw new ServiceUnavailableError(
      'Coupon service URL resolves to a private network'
    )
  }
  return addresses[0]
}
