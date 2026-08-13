import { verifyEvent, type NostrEvent } from 'nostr-tools/pure'
import { expect } from 'vitest'

export const ENDPOINT = 'https://instance.test'

/** Decodes an `Authorization: Nostr <b64>` header into its kind-27235 event. */
export function decodeNip98Header(header: string | null): NostrEvent {
  expect(header).toMatch(/^Nostr /)
  return JSON.parse(atob(header!.slice('Nostr '.length)))
}

export function tag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(t => t[0] === name)?.[1]
}

/** Asserts the event is a validly signed NIP-98 commitment to url+method. */
export function expectValidNip98(
  event: NostrEvent,
  url: string,
  method: string
) {
  expect(event.kind).toBe(27235)
  expect(verifyEvent(event)).toBe(true)
  expect(tag(event, 'u')).toBe(url)
  expect(tag(event, 'method')).toBe(method)
}
