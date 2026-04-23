'use client'

import type { NostrSigner } from '@nostrify/nostrify'
import { DEFAULT_NOSTR_RELAYS, parseKind0Content, type NostrProfile } from './nostr-profile'

export interface ProfileFields {
  name?: string
  displayName?: string
  picture?: string
  banner?: string
  about?: string
  nip05?: string
  lud16?: string
  website?: string
}

/**
 * Build a kind-0 event from the merged content, sign it with the supplied
 * signer, and publish to at least one of the default relays. Returns the
 * signed event so callers can seed their local cache immediately.
 *
 * Merge strategy: the caller passes only the fields they want to change;
 * we merge them over the current on-relay fields so unrelated profile keys
 * (e.g. zap settings, picture the user set elsewhere) aren't dropped.
 */
export async function publishProfile(
  signer: NostrSigner,
  currentProfile: NostrProfile | null,
  patch: ProfileFields,
): Promise<NostrProfile> {
  const { SimplePool, finalizeEvent } = await Promise.resolve().then(async () => {
    const pool = await import('nostr-tools/pool')
    // finalizeEvent only fires for nsec signers; remote signers (bunker /
    // extension) produce a fully-signed event via signEvent and don't need
    // it. We keep the module reference here so the dynamic import graph
    // stays symmetric.
    const pure = await import('nostr-tools/pure')
    return { SimplePool: pool.SimplePool, finalizeEvent: pure.finalizeEvent }
  })

  // Preserve any kind-0 keys the app doesn't model by merging at the
  // serialized-content level when we can. If we only have a parsed
  // NostrProfile, reconstruct the Nostr content fields from it. Nostr
  // convention uses snake_case for `display_name`.
  const merged: Record<string, unknown> = {}
  if (currentProfile) {
    if (currentProfile.name !== undefined) merged.name = currentProfile.name
    if (currentProfile.displayName !== undefined) merged.display_name = currentProfile.displayName
    if (currentProfile.picture !== undefined) merged.picture = currentProfile.picture
    if (currentProfile.banner !== undefined) merged.banner = currentProfile.banner
    if (currentProfile.about !== undefined) merged.about = currentProfile.about
    if (currentProfile.nip05 !== undefined) merged.nip05 = currentProfile.nip05
    if (currentProfile.lud16 !== undefined) merged.lud16 = currentProfile.lud16
    if (currentProfile.website !== undefined) merged.website = currentProfile.website
  }
  if (patch.name !== undefined) merged.name = patch.name
  if (patch.displayName !== undefined) merged.display_name = patch.displayName
  if (patch.picture !== undefined) merged.picture = patch.picture
  if (patch.banner !== undefined) merged.banner = patch.banner
  if (patch.about !== undefined) merged.about = patch.about
  if (patch.nip05 !== undefined) merged.nip05 = patch.nip05
  if (patch.lud16 !== undefined) merged.lud16 = patch.lud16
  if (patch.website !== undefined) merged.website = patch.website

  const content = JSON.stringify(merged)
  const template = {
    kind: 0,
    content,
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
  }

  const signed = await signer.signEvent(template)

  const pool = new SimplePool()
  try {
    // Publish to all relays in parallel; at least one must accept or we
    // surface the error. Promise.any resolves on first success.
    await Promise.any(pool.publish(DEFAULT_NOSTR_RELAYS, signed as never))
  } finally {
    try {
      pool.close(DEFAULT_NOSTR_RELAYS)
    } catch {
      // best-effort cleanup — a closed pool can throw on already-closed sockets
    }
  }

  const parsed = parseKind0Content(signed.pubkey, signed.content)
  if (!parsed) {
    throw new Error('Published profile but failed to parse the signed content back')
  }
  return parsed
}
