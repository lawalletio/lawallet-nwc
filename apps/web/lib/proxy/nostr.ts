import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { nip19, SimplePool } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import { ValidationError } from '@/types/server/errors'

const HEX_64 = /^[0-9a-f]{64}$/i
const MAX_ZAP_SKEW_SECONDS = 10 * 60

export function normalizeNostrPrivateKey(value: string): string {
  const trimmed = value.trim()
  if (HEX_64.test(trimmed)) return trimmed.toLowerCase()
  const decoded = nip19.decode(trimmed)
  if (decoded.type !== 'nsec' || !(decoded.data instanceof Uint8Array)) {
    throw new Error('Receipt signer must be an nsec or 64-character hex key')
  }
  return Buffer.from(decoded.data).toString('hex')
}

export function receiptPubkey(privateKeyHex: string): string {
  return getPublicKey(Buffer.from(privateKeyHex, 'hex'))
}

export interface ValidZapRequest {
  event: Event
  canonicalJson: string
  relays: string[]
}

export function validateZapRequest(input: {
  raw: string
  amountMsats: number
  recipientPubkey: string
  nowSeconds?: number
}): ValidZapRequest {
  let event: Event
  try {
    event = JSON.parse(input.raw) as Event
  } catch {
    throw new ValidationError('Zap request is not valid JSON')
  }
  if (
    event.kind !== 9734 ||
    !verifyEvent(event) ||
    Math.abs(
      (input.nowSeconds ?? Math.floor(Date.now() / 1000)) - event.created_at
    ) > MAX_ZAP_SKEW_SECONDS
  ) {
    throw new ValidationError(
      'Zap request signature, kind, or timestamp is invalid'
    )
  }
  const pTags = event.tags.filter(tag => tag[0] === 'p')
  if (
    pTags.length !== 1 ||
    pTags[0][1]?.toLowerCase() !== input.recipientPubkey.toLowerCase()
  ) {
    throw new ValidationError(
      'Zap request recipient does not match this address'
    )
  }
  const amountTag = event.tags.find(tag => tag[0] === 'amount')?.[1]
  if (
    amountTag !== undefined &&
    (!/^\d+$/.test(amountTag) || Number(amountTag) !== input.amountMsats)
  ) {
    throw new ValidationError(
      'Zap request amount does not match callback amount'
    )
  }
  // The `lnurl` tag is deliberately not validated. It is optional in NIP-57,
  // clients disagree on the encoding (bech32, the LNURL-pay URL, or the bare
  // Lightning Address), and one address is legitimately reachable at several
  // origins — a local port, the public domain, a tunnel — so there is no single
  // correct value to compare against. It carries no authority either: the
  // invoice is minted on this address' own wallet and the recipient is fixed by
  // the `p` tag below, so a wrong `lnurl` cannot misdirect funds or credit.
  // The tag is still preserved verbatim in the stored request, which is what
  // the receipt's description commits to.
  const relays = [
    ...new Set(
      event.tags
        .find(tag => tag[0] === 'relays')
        ?.slice(1)
        .filter(isRelayUrl)
        .slice(0, 8) ?? []
    )
  ]
  if (relays.length === 0) {
    throw new ValidationError('Zap request must include at least one relay')
  }
  // The raw string is the exact value committed into description_hash and
  // copied into the receipt's description tag.
  return { event, canonicalJson: input.raw, relays }
}

export interface PublishedZapReceipt {
  event: Event
  json: string
}

/**
 * Sign a deterministic NIP-57 kind:9735 receipt.
 *
 * Keeping creation separate from relay publication lets payment audit records
 * retain the exact event that was attempted. With a persisted settlement time
 * the same receipt id is produced after a crash or relay timeout, so a retry
 * cannot create a second zap receipt for the same payment.
 */
function createZapReceipt(input: {
  zapRequest: Event
  zapRequestJson: string
  payerInvoice: string
  payerPreimage?: string | null
  privateKeyHex: string
  /** Persisted forwarding time keeps the receipt event id stable on retries. */
  createdAtSeconds: number
}): Event {
  const copiedTags = input.zapRequest.tags.filter(tag =>
    ['e', 'p', 'a'].includes(tag[0])
  )
  return finalizeEvent(
    {
      kind: 9735,
      created_at: input.createdAtSeconds,
      content: '',
      tags: [
        ...copiedTags,
        ['bolt11', input.payerInvoice],
        ['description', input.zapRequestJson],
        ...(input.payerPreimage ? [['preimage', input.payerPreimage]] : [])
      ]
    },
    Buffer.from(input.privateKeyHex, 'hex')
  )
}

export async function publishZapReceipt(input: {
  zapRequest: Event
  zapRequestJson: string
  payerInvoice: string
  payerPreimage?: string | null
  privateKeyHex: string
  createdAtSeconds: number
}): Promise<PublishedZapReceipt> {
  const relays =
    input.zapRequest.tags
      .find(tag => tag[0] === 'relays')
      ?.slice(1)
      .filter(isRelayUrl)
      .slice(0, 8) ?? []
  if (relays.length === 0) throw new Error('Zap request has no publish relays')

  const event = createZapReceipt(input)

  const pool = new SimplePool()
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      Promise.any(pool.publish(relays, event)),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Zap receipt relay publication timed out')),
          30_000
        )
        timeout.unref?.()
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    pool.close(relays)
  }
  return { event, json: JSON.stringify(event) }
}


function isRelayUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'wss:' || url.protocol === 'ws:') &&
      url.hostname.length > 0
    )
  } catch {
    return false
  }
}
