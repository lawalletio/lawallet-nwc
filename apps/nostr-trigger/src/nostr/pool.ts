import { SimplePool, type Filter, type Event } from 'nostr-tools'
import { createChildLogger } from '../logger.js'
import { normalizeRelayUrl } from './nwc.js'

const log = createChildLogger({ module: 'relay-pool' })

export type SubscribeOpts = {
  subId: string
  relays: string[]
  filter: Filter
  onEvent: (event: Event, relayUrl: string) => void
  onEose?: (relayUrl: string) => void
}

export type SubscriptionHandle = {
  subId: string
  relays: string[]
  close: () => void
}

export type RelayStatus = {
  url: string
  connected: boolean
  lastError?: string
  inflightSubs: number
}

/**
 * Thin wrapper over nostr-tools SimplePool that:
 *  - normalises relay URLs (no trailing slashes, lowercase)
 *  - reference-counts subscriptions per relay so we can track active sub count
 *  - exposes a uniform status view for the /api/v1/status endpoint
 *  - fans out publishes with Promise.allSettled so one slow relay doesn't block
 */
export class RelayPool {
  private pool = new SimplePool()
  private subs = new Map<string, SubscriptionHandle>()
  private relayRefs = new Map<string, number>()
  private lastErrors = new Map<string, string>()

  subscribe(opts: SubscribeOpts): SubscriptionHandle {
    if (this.subs.has(opts.subId)) {
      throw new Error(`Subscription already exists: ${opts.subId}`)
    }

    const relays = opts.relays.map(normalizeRelayUrl)

    const sub = this.pool.subscribeMany(relays, opts.filter, {
      onevent: (ev: Event) => {
        try {
          opts.onEvent(ev, relays[0] ?? '')
        } catch (err) {
          log.error({ err, subId: opts.subId }, 'onEvent handler threw')
        }
      },
      oneose: () => {
        if (opts.onEose) {
          for (const r of relays) opts.onEose(r)
        }
      }
    })

    for (const r of relays) {
      this.relayRefs.set(r, (this.relayRefs.get(r) ?? 0) + 1)
    }

    const handle: SubscriptionHandle = {
      subId: opts.subId,
      relays,
      close: () => {
        sub.close()
        this.subs.delete(opts.subId)
        for (const r of relays) {
          const next = (this.relayRefs.get(r) ?? 1) - 1
          if (next <= 0) this.relayRefs.delete(r)
          else this.relayRefs.set(r, next)
        }
        log.debug({ subId: opts.subId }, 'subscription closed')
      }
    }

    this.subs.set(opts.subId, handle)
    log.debug(
      { subId: opts.subId, relays, filter: opts.filter },
      'subscription opened'
    )
    return handle
  }

  async publish(relays: string[], event: Event): Promise<{
    accepted: string[]
    rejected: Array<{ relay: string; error: string }>
  }> {
    const normalized = relays.map(normalizeRelayUrl)
    const results = await Promise.allSettled(
      this.pool.publish(normalized, event)
    )

    const accepted: string[] = []
    const rejected: Array<{ relay: string; error: string }> = []
    results.forEach((r, i) => {
      const url = normalized[i]
      if (r.status === 'fulfilled') {
        accepted.push(url)
      } else {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason)
        rejected.push({ relay: url, error: reason })
        this.lastErrors.set(url, reason)
      }
    })

    log.debug(
      { event_id: event.id, accepted, rejectedCount: rejected.length },
      'published'
    )
    return { accepted, rejected }
  }

  status(): RelayStatus[] {
    const urls = new Set<string>([
      ...this.relayRefs.keys(),
      ...this.lastErrors.keys()
    ])
    return Array.from(urls).map(url => ({
      url,
      connected: this.relayRefs.has(url),
      lastError: this.lastErrors.get(url),
      inflightSubs: this.relayRefs.get(url) ?? 0
    }))
  }

  activeSubscriptions(): SubscriptionHandle[] {
    return Array.from(this.subs.values())
  }

  closeAll(): void {
    for (const h of this.subs.values()) h.close()
    this.pool.close(Array.from(this.relayRefs.keys()))
    this.subs.clear()
    this.relayRefs.clear()
  }
}
