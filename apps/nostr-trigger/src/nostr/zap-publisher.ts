import { finalizeEvent, type Event } from 'nostr-tools/pure'
import { hexToBytes } from 'nostr-tools/utils'
import { getConfig } from '../config/index.js'
import { createChildLogger } from '../logger.js'
import { prisma } from '../db/prisma.js'
import { nsecToHex } from './nwc.js'
import type { RelayPool } from './pool.js'
import { dashboardBus } from '../events/bus.js'

const log = createChildLogger({ module: 'zap-publisher' })

export type ZapInput = {
  bolt11: string
  preimage?: string
  zapRequest: Event
  recipientPubkey: string
  extraRelays?: string[]
}

/**
 * Builds + signs + publishes a NIP-57 kind-9735 zap receipt using the
 * service's LNURL nsec, then records the receipt in ZapReceiptLedger.
 */
export class ZapReceiptPublisher {
  constructor(private pool: RelayPool) {}

  async publish(input: ZapInput): Promise<{ eventId: string; relays: string[] }> {
    const { lnurlNsec, zapDefaultRelays } = getConfig().nostr
    if (!lnurlNsec) {
      throw new Error('NT_LNURL_NSEC not configured — cannot sign zap receipts')
    }
    const skHex = nsecToHex(lnurlNsec)
    const sk = hexToBytes(skHex)

    const requestRelays =
      input.zapRequest.tags
        .find(t => t[0] === 'relays')
        ?.slice(1)
        .filter(Boolean) ?? []

    const relays = Array.from(
      new Set([...zapDefaultRelays, ...requestRelays, ...(input.extraRelays ?? [])])
    )

    if (relays.length === 0) {
      throw new Error('No relays available for zap publish')
    }

    const eTag = input.zapRequest.tags.find(t => t[0] === 'e')
    const aTag = input.zapRequest.tags.find(t => t[0] === 'a')

    const tags: string[][] = [
      ['p', input.recipientPubkey],
      ['bolt11', input.bolt11],
      ['description', JSON.stringify(input.zapRequest)]
    ]
    if (input.preimage) tags.push(['preimage', input.preimage])
    if (eTag) tags.push(eTag)
    if (aTag) tags.push(aTag)

    const template = {
      kind: 9735,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags
    }

    const receipt = finalizeEvent(template, sk)

    const existing = await prisma.zapReceiptLedger.findUnique({
      where: { eventId: receipt.id }
    })
    if (existing) {
      log.info({ eventId: receipt.id }, 'zap receipt already published')
      return { eventId: receipt.id, relays: existing.relays }
    }

    const { accepted, rejected } = await this.pool.publish(relays, receipt)
    log.info(
      { eventId: receipt.id, accepted: accepted.length, rejected: rejected.length },
      'zap receipt published'
    )

    await prisma.zapReceiptLedger.create({
      data: {
        eventId: receipt.id,
        bolt11: input.bolt11,
        recipient: input.recipientPubkey,
        zapRequest: input.zapRequest as unknown as object,
        relays: accepted
      }
    })

    dashboardBus.emit({
      type: 'zap',
      eventId: receipt.id,
      recipient: input.recipientPubkey,
      relays: accepted,
      ts: Date.now()
    })

    return { eventId: receipt.id, relays: accepted }
  }
}
