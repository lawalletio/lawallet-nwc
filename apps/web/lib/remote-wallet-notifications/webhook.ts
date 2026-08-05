import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import {
  createPinnedLookup,
  isPrivateNetworkAddress,
  type SafeAddress
} from '@/lib/proxy/lnurl'

const TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 32 * 1024

export interface WebhookResponse {
  status: number
  body: string
}

/**
 * POST to a public HTTPS endpoint after resolving and pinning its address.
 * This protects notification webhooks from DNS rebinding and private-network
 * access while preserving TLS validation for the configured hostname.
 */
export async function postNotificationWebhook(input: {
  url: string
  requestId: string
  eventKey: string
  body: string
}): Promise<WebhookResponse> {
  const url = new URL(input.url)
  if (url.protocol !== 'https:' || !url.hostname) {
    throw new Error('Webhook URL must use HTTPS')
  }
  if (url.username || url.password) {
    throw new Error('Webhook URL must not contain credentials')
  }
  const pinned = await resolveSafeAddress(url.hostname)
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        lookup: createPinnedLookup(pinned),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(input.body),
          'idempotency-key': input.requestId,
          'x-lawallet-event': input.eventKey,
          'user-agent': 'LaWallet-RemoteWallet-Notifications/1'
        }
      },
      response => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer | Uint8Array | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += bytes.length
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(new Error('Webhook response is too large'))
            return
          }
          chunks.push(bytes)
        })
        response.once('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
        response.once('error', reject)
      }
    )
    request.once('error', reject)
    request.end(input.body)
  })
}

async function resolveSafeAddress(hostname: string): Promise<SafeAddress> {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    throw new Error('Webhook URL resolves to a private network')
  }
  const family = isIP(normalized)
  const addresses: SafeAddress[] = family
    ? [{ address: normalized, family: family as 4 | 6 }]
    : (await lookup(normalized, { all: true, verbatim: true })).map(item => ({
        address: item.address,
        family: item.family as 4 | 6
      }))
  if (
    addresses.length === 0 ||
    addresses.some(address => isPrivateNetworkAddress(address.address))
  ) {
    throw new Error('Webhook URL resolves to a private network')
  }
  return addresses[0]
}
