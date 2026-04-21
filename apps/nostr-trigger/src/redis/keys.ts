import { createHash } from 'node:crypto'

const NS = 'nt:'

export const redisKeys = {
  dedup: (eventId: string) => `${NS}dedup:${eventId}`,
  cursor: (nwcConnectionId: string, relayUrl: string) =>
    `${NS}cursor:${nwcConnectionId}:${hashRelay(relayUrl)}`,
  relayStatus: (relayUrl: string) =>
    `${NS}relay:${hashRelay(relayUrl)}:status`,
  webhookQueue: 'nt:webhooks'
}

function hashRelay(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16)
}

export { hashRelay }
