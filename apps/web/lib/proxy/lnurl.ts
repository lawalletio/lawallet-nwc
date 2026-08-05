import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import type { IncomingHttpHeaders } from 'node:http'
import { z } from 'zod'
import {
  extractPaymentHash,
  parseExactPaymentInvoice
} from '@/lib/invoice-utils'
import { parseLightningAddress } from '@/lib/wallet/resolve-payment-route'
import { isDestinationInvoiceAmountAcceptable } from './money'

const MAX_RESPONSE_BYTES = 64 * 1024
const FETCH_TIMEOUT_MS = 7000
const MAX_REDIRECTS = 3
const blockedNetworks = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4]
] as const) {
  blockedNetworks.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32]
] as const) {
  blockedNetworks.addSubnet(network, prefix, 'ipv6')
}

const payMetadataSchema = z.object({
  status: z.string().optional(),
  reason: z.string().optional(),
  tag: z.literal('payRequest'),
  callback: z.string().url(),
  minSendable: z.number().int().positive(),
  maxSendable: z.number().int().positive(),
  metadata: z.string().default('[]'),
  commentAllowed: z.number().int().nonnegative().optional(),
  allowsNostr: z.boolean().optional(),
  nostrPubkey: z.string().optional()
})

export type ProxyLnurlMetadata = z.infer<typeof payMetadataSchema>

export async function fetchDestinationMetadata(
  address: string,
  options: { blockedHosts?: string[] } = {}
): Promise<ProxyLnurlMetadata> {
  const parsed = parseLightningAddress(address)
  if (!parsed) throw new Error('Destination Lightning Address is invalid')
  return fetchMetadataUrl(
    new URL(
      `https://${parsed.host}/.well-known/lnurlp/${encodeURIComponent(parsed.user)}`
    ),
    options.blockedHosts ?? []
  )
}

async function fetchMetadataUrl(
  initialUrl: URL,
  blockedHosts: string[]
): Promise<ProxyLnurlMetadata> {
  let url = initialUrl
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await safeHttpsGet(url, blockedHosts)
    if (response.status >= 300 && response.status < 400) {
      const location = firstHeader(response.headers.location)
      if (!location || redirect === MAX_REDIRECTS) {
        throw new Error('Destination LNURL redirected too many times')
      }
      url = new URL(location, url)
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Destination LNURL returned HTTP ${response.status}`)
    }
    const parsed = payMetadataSchema.safeParse(
      parseJson(response.body, 'Destination returned invalid JSON')
    )
    if (!parsed.success || parsed.data.status === 'ERROR') {
      throw new Error(
        parsed.success
          ? parsed.data.reason || 'Destination rejected LNURL request'
          : 'Destination returned invalid LNURL metadata'
      )
    }
    if (parsed.data.maxSendable < parsed.data.minSendable) {
      throw new Error('Destination LNURL amount range is invalid')
    }
    await resolveSafeAddress(new URL(parsed.data.callback), blockedHosts)
    return parsed.data
  }
  throw new Error('Destination LNURL could not be resolved')
}

export async function requestDestinationInvoice(input: {
  metadata: ProxyLnurlMetadata
  amountMsats: number
  comment?: string | null
  blockedHosts?: string[]
}): Promise<{
  bolt11: string
  paymentHash: string
  amountMsats: number
  expiresAt: Date
}> {
  const callback = new URL(input.metadata.callback)
  callback.searchParams.set('amount', String(input.amountMsats))
  if (input.comment && (input.metadata.commentAllowed ?? 0) > 0) {
    callback.searchParams.set(
      'comment',
      input.comment.slice(0, input.metadata.commentAllowed)
    )
  }

  const response = await safeHttpsGet(callback, input.blockedHosts ?? [])
  if (response.status >= 300 && response.status < 400) {
    throw new Error('Destination callback must not redirect')
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Destination callback returned HTTP ${response.status}`)
  }
  const json = parseJson(
    response.body,
    'Destination callback returned invalid JSON'
  ) as {
    status?: string
    reason?: string
    pr?: unknown
  }
  if (json.status === 'ERROR') {
    throw new Error(json.reason || 'Destination callback rejected payment')
  }
  if (typeof json.pr !== 'string' || !json.pr) {
    throw new Error('Destination callback did not return a BOLT11 invoice')
  }
  const invoice = parseExactPaymentInvoice(json.pr)
  if (
    !isDestinationInvoiceAmountAcceptable(
      input.amountMsats,
      invoice.amountMsats
    )
  ) {
    throw new Error(
      'Destination invoice amount exceeds the proxy amount or is more than 10 sats lower'
    )
  }
  const paymentHash = extractPaymentHash(json.pr)
  if (!paymentHash || paymentHash !== invoice.paymentHash) {
    throw new Error('Destination invoice payment hash is invalid')
  }
  if (invoice.expiresAt <= Date.now()) {
    throw new Error('Destination returned an expired invoice')
  }
  return {
    bolt11: json.pr,
    paymentHash,
    amountMsats: invoice.amountMsats,
    expiresAt: new Date(invoice.expiresAt)
  }
}

export interface SafeAddress {
  address: string
  family: 4 | 6
}

interface SafeResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Uint8Array
}

/**
 * Resolve once, reject every private answer, then pin the HTTPS socket to the
 * checked address. This closes the classic resolve-check-fetch DNS rebinding
 * gap while preserving TLS hostname validation and SNI for the original host.
 */
async function resolveSafeAddress(
  url: URL,
  blockedHosts: string[]
): Promise<SafeAddress> {
  if (url.protocol !== 'https:' || !url.hostname) {
    throw new Error('Destination LNURL must use HTTPS')
  }
  if (url.username || url.password) {
    throw new Error('Destination LNURL must not contain credentials')
  }
  const hostname = normalizeHostname(url.hostname)
  if (blockedHosts.map(normalizeHostname).filter(Boolean).includes(hostname)) {
    throw new Error('Destination LNURL points back to this LaWallet instance')
  }
  const family = isIP(hostname)
  const addresses: SafeAddress[] = family
    ? [{ address: hostname, family: family as 4 | 6 }]
    : (
        await withTimeout(
          lookup(hostname, { all: true, verbatim: true }),
          FETCH_TIMEOUT_MS,
          'Destination DNS lookup timed out'
        )
      ).map(item => ({
        address: item.address,
        family: item.family as 4 | 6
      }))
  if (
    addresses.length === 0 ||
    addresses.some(item => isPrivateNetworkAddress(item.address))
  ) {
    throw new Error('Destination LNURL resolves to a private network')
  }
  return addresses[0]
}

async function safeHttpsGet(
  url: URL,
  blockedHosts: string[]
): Promise<SafeResponse> {
  const pinned = await resolveSafeAddress(url, blockedHosts)
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'LaWallet-LUD16-Proxy/1'
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        lookup: createPinnedLookup(pinned)
      },
      response => {
        const declaredLength = Number(response.headers['content-length'] ?? 0)
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > MAX_RESPONSE_BYTES
        ) {
          response.destroy(new Error('Destination LNURL response is too large'))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer | Uint8Array | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += bytes.length
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(
              new Error('Destination LNURL response is too large')
            )
            return
          }
          chunks.push(bytes)
        })
        response.once('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Uint8Array.from(Buffer.concat(chunks))
          })
        })
        response.once('error', reject)
      }
    )
    request.once('error', reject)
    request.end()
  })
}

/**
 * Pin the request to the address that passed the SSRF checks. Recent Node
 * versions may ask custom lookup functions for every address (`all: true`)
 * when auto-family selection is enabled; that callback must receive an array.
 */
export function createPinnedLookup(pinned: SafeAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [pinned])
      return
    }
    callback(null, pinned.address, pinned.family)
  }
}

function parseJson(bytes: Uint8Array, message: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error(message)
  }
}

function firstHeader(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        timer.unref?.()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function normalizeHostname(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/\.$/, '')
  if (!trimmed) return ''
  try {
    return new URL(
      trimmed.includes('://') ? trimmed : `https://${trimmed}`
    ).hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
  } catch {
    return trimmed.replace(/^\[|\]$/g, '').split(':')[0]
  }
}

export function isPrivateNetworkAddress(raw: string): boolean {
  const ip = raw.toLowerCase()
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  const mappedFromHex = mappedHex
    ? [
        parseInt(mappedHex[1], 16) >> 8,
        parseInt(mappedHex[1], 16) & 0xff,
        parseInt(mappedHex[2], 16) >> 8,
        parseInt(mappedHex[2], 16) & 0xff
      ].join('.')
    : null
  const v4 = mapped ?? mappedFromHex ?? (isIP(ip) === 4 ? ip : null)
  if (v4) return blockedNetworks.check(v4, 'ipv4')
  return isIP(ip) === 6 && blockedNetworks.check(ip, 'ipv6')
}
