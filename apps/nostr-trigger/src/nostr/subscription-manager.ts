import type { Event } from 'nostr-tools'
import { prisma } from '../db/prisma.js'
import { createChildLogger } from '../logger.js'
import { RelayPool } from './pool.js'
import { getCursor } from '../ingest/cursor.js'
import { handleNwcNotification } from '../ingest/handler.js'
import { getConfig } from '../config/index.js'

const log = createChildLogger({ module: 'subscription-manager' })

const SUB_PREFIX = 'nwc-'
const NWC_KINDS = [23196, 23197]

function subIdFor(nwcId: string): string {
  return `${SUB_PREFIX}${nwcId}`
}

/**
 * Reconciles desired NwcConnection subscriptions against the RelayPool's
 * active set. Each enabled NwcConnection gets one REQ on its relays filtered
 * by `authors=[walletPubkey]` and `#p=[clientPubkey]`. Per-(nwc, relay)
 * `since` cursors come from Redis so restarts resume without replay loss.
 */
export class ConnectionManager {
  constructor(private pool: RelayPool) {}

  async start(): Promise<void> {
    const connections = await prisma.nwcConnection.findMany({
      where: { enabled: true }
    })
    log.info({ count: connections.length }, 'loading nwc connections')
    for (const c of connections) {
      await this.open(c.id)
    }
  }

  async open(nwcId: string): Promise<void> {
    const conn = await prisma.nwcConnection.findUnique({ where: { id: nwcId } })
    if (!conn || !conn.enabled) return

    const subId = subIdFor(nwcId)
    await this.close(nwcId).catch(() => {})

    const { cursorOverlapSeconds } = getConfig().runtime
    const primaryRelay = conn.relays[0] ?? ''
    const cursor = await getCursor(nwcId, primaryRelay)
    const nowSec = Math.floor(Date.now() / 1000)
    const since = cursor
      ? Math.max(0, cursor - cursorOverlapSeconds)
      : nowSec - cursorOverlapSeconds

    this.pool.subscribe({
      subId,
      relays: conn.relays,
      filter: {
        kinds: NWC_KINDS,
        authors: [conn.walletPubkey],
        '#p': [conn.clientPubkey],
        since
      },
      onEvent: (event: Event, relayUrl: string) => {
        void handleNwcNotification({
          nwcConnection: conn,
          event,
          relayUrl
        }).catch(err => log.error({ err, nwcId }, 'ingest handler failed'))
      }
    })

    log.info({ nwcId, relays: conn.relays, since }, 'subscription opened')
  }

  async close(nwcId: string): Promise<void> {
    const subId = subIdFor(nwcId)
    const sub = this.pool.activeSubscriptions().find(s => s.subId === subId)
    if (sub) {
      sub.close()
      log.info({ nwcId }, 'subscription closed')
    }
  }

  async reload(nwcId: string): Promise<void> {
    await this.close(nwcId)
    await this.open(nwcId)
  }

  async reloadAll(): Promise<void> {
    for (const sub of this.pool.activeSubscriptions()) {
      sub.close()
    }
    await this.start()
  }

  activeSubCount(): number {
    return this.pool
      .activeSubscriptions()
      .filter(s => s.subId.startsWith(SUB_PREFIX)).length
  }
}
