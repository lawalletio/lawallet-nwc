import { promises as fs } from 'node:fs'

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { normalizeNostrPubkey } from '@/lib/nostr/profile'
import { resolveProfiles } from '@/lib/nostr/profile-cache'

/**
 * Attaches a user's cached Nostr avatar (kind:0 `picture`) to their LUD-16
 * payRequest as a base64 `image/*;base64` metadata entry — the same shape
 * wallets already render for e.g. `lacrypta.ar/.well-known/lnurlp/<name>`.
 *
 * Everything here reads the LOCAL cache only and never blocks the payment path
 * on a relay fetch. The kind:0 + image download itself is done by the existing
 * `resolveProfiles` → `precacheProfileImages` flow (server-side Nostr profile
 * cache, #60); `warmNostrProfileForLud16` kicks that flow the first time we see
 * a pubkey so subsequent payRequests can embed the avatar.
 */

// Only mimes wallets reliably render inline. The image cache also stores
// gif/avif, but those are skipped here to avoid odd renders in payer wallets.
const EMBEDDABLE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

// Hard cap on the raw image we inline. LUD-06 metadata is echoed on every
// payRequest and (for description-hash wallets) folded into the invoice, so a
// multi-MB avatar would bloat every response. Larger cached avatars are simply
// omitted rather than embedded.
const MAX_EMBEDDED_IMAGE_BYTES = 256 * 1024

/**
 * Build the `[`image/<type>;base64`, <data>]` LUD-06 metadata entry for a
 * user's cached avatar, or `null` when nothing usable is cached. Reads the
 * cache row + on-disk file only — fast, no network.
 */
export async function getLud16AvatarMetadataEntry(
  pubkey: string,
  db: typeof prisma = prisma,
): Promise<[string, string] | null> {
  const normalized = normalizeNostrPubkey(pubkey)
  if (!normalized) return null

  const row = await db.nostrProfileImageCache.findUnique({
    where: { npub_kind: { npub: normalized.npub, kind: 'AVATAR' } },
    select: { cachePath: true, contentType: true, byteSize: true },
  })

  if (!row?.cachePath || !row.contentType) return null
  if (!EMBEDDABLE_MIME.has(row.contentType)) return null
  if (row.byteSize != null && row.byteSize > MAX_EMBEDDED_IMAGE_BYTES) return null

  try {
    const bytes = await fs.readFile(row.cachePath)
    if (bytes.byteLength > MAX_EMBEDDED_IMAGE_BYTES) return null
    return [`${row.contentType};base64`, bytes.toString('base64')]
  } catch (err) {
    // A missing/unreadable cache file just means "no avatar this time" — the
    // payRequest must still succeed.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), npub: normalized.npub },
      'LUD16 avatar read failed',
    )
    return null
  }
}

/**
 * Fire-and-forget: warm the Nostr profile cache for a pubkey so its avatar is
 * available on the NEXT payRequest. Only triggers a relay fetch the first time
 * we encounter a pubkey (no cache row yet) — once an attempt has been recorded,
 * staleness refresh is left to the profile endpoint / background jobs so the
 * payment path never repeatedly hammers relays for users without a kind:0.
 */
export function warmNostrProfileForLud16(
  pubkey: string,
  db: typeof prisma = prisma,
): void {
  void (async () => {
    try {
      const normalized = normalizeNostrPubkey(pubkey)
      if (!normalized) return
      const existing = await db.nostrProfileCache.findUnique({
        where: { pubkey: normalized.pubkey },
        select: { pubkey: true },
      })
      if (existing) return
      await resolveProfiles([normalized.pubkey], { db })
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'LUD16 profile warm failed',
      )
    }
  })()
}
