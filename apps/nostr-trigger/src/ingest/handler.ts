import { verifyEvent, type Event } from 'nostr-tools'
import type { NwcConnection, WebhookEndpoint } from '@lawallet-nwc/prisma'
import { prisma } from '../db/prisma.js'
import { createChildLogger } from '../logger.js'
import { claimEventId } from './dedup.js'
import { advanceCursor } from './cursor.js'
import { decryptWithFallback } from '../nostr/encryption.js'
import { decryptSecret } from '../security/crypto.js'
import { enqueueWebhook } from '../webhooks/queue.js'
import { dashboardBus } from '../events/bus.js'

const log = createChildLogger({ module: 'ingest' })

export type IngestInput = {
  nwcConnection: NwcConnection
  event: Event
  relayUrl: string
}

/**
 * Processes a single kind-23196/23197 notification:
 *  1. verify signature
 *  2. dedup via Redis SET NX
 *  3. decrypt content (NIP-44 → NIP-04 fallback)
 *  4. persist audit row
 *  5. advance cursor for (nwc, relay)
 *  6. enqueue one webhook delivery job per enabled endpoint
 */
export async function handleNwcNotification(input: IngestInput): Promise<void> {
  const { nwcConnection, event, relayUrl } = input

  if (!verifyEvent(event)) {
    log.warn({ id: event.id }, 'signature verification failed — dropping')
    return
  }

  const claimed = await claimEventId(event.id)
  if (!claimed) {
    log.debug({ id: event.id }, 'duplicate event — skipping')
    return
  }

  let decrypted: string
  try {
    const clientSecretHex = decryptSecret(nwcConnection.clientSecret)
    decrypted = decryptWithFallback(
      clientSecretHex,
      nwcConnection.walletPubkey,
      event.content
    )
  } catch (err) {
    log.error({ err, id: event.id }, 'decryption failed — dropping')
    return
  }

  let payload: unknown
  try {
    payload = JSON.parse(decrypted)
  } catch {
    payload = { raw: decrypted }
  }

  await prisma.auditEvent.create({
    data: {
      source: 'runtime',
      actor: 'system',
      action: 'nwc_notification',
      target: nwcConnection.id,
      payload: {
        eventId: event.id,
        kind: event.kind,
        relayUrl,
        createdAt: event.created_at,
        payload: payload as object
      } as object
    }
  })

  await advanceCursor(nwcConnection.id, relayUrl, event.created_at)

  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      nwcConnectionId: nwcConnection.id,
      enabled: true
    }
  })

  const matching = endpoints.filter((ep: WebhookEndpoint) =>
    ep.eventKinds.length === 0 || ep.eventKinds.includes(event.kind)
  )

  for (const ep of matching) {
    await enqueueWebhook({
      webhookEndpointId: ep.id,
      eventId: event.id,
      eventKind: event.kind,
      nwcConnectionId: nwcConnection.id,
      payload
    })
  }

  log.info(
    {
      id: event.id,
      nwcId: nwcConnection.id,
      fanOut: matching.length,
      relayUrl
    },
    'nwc notification ingested'
  )

  dashboardBus.emit({
    type: 'notification',
    nwcConnectionId: nwcConnection.id,
    eventId: event.id,
    eventKind: event.kind,
    relayUrl,
    createdAt: event.created_at,
    payload,
    ts: Date.now()
  })
}
