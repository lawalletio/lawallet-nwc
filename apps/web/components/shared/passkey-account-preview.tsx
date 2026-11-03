'use client'

import { useEffect } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  useNostrProfile,
  DEFAULT_NOSTR_RELAYS,
  parseKind0Content
} from '@/lib/client/nostr-profile'
import { npubInitials, toNpub } from '@/lib/client/format'
import { useT } from '@/lib/client/i18n'

/** Public metadata is a recognition aid; the full public key stays visible. */
export function PasskeyAccountPreview({ pubkey }: { pubkey: string }) {
  const { profile, updateProfile } = useNostrProfile(pubkey)
  const t = useT().auth.passkeyImport

  useEffect(() => {
    if (profile) return
    let cancelled = false
    let close: (() => void) | undefined
    // The server profile endpoint requires login. Read public metadata directly
    // for this confirmation, then reuse the existing profile cache.
    void (async () => {
      const [{ SimplePool }, { verifyEvent }] = await Promise.all([
        import('nostr-tools/pool'),
        import('nostr-tools/pure')
      ])
      if (cancelled) return
      const pool = new SimplePool()
      close = () => pool.close(DEFAULT_NOSTR_RELAYS)
      try {
        const events = await pool.querySync(
          DEFAULT_NOSTR_RELAYS,
          { kinds: [0], authors: [pubkey], limit: 1 },
          { maxWait: 3000 }
        )
        const event = events
          .filter(e => e.kind === 0 && e.pubkey === pubkey && verifyEvent(e))
          .sort((a, b) => b.created_at - a.created_at)[0]
        const next = event && parseKind0Content(pubkey, event.content)
        if (!cancelled && next) updateProfile(next)
      } finally {
        close()
      }
    })().catch(() => {
      /* Metadata is optional; confirmation stays available. */
    })
    return () => {
      cancelled = true
      close?.()
    }
  }, [pubkey, profile, updateProfile])

  const name = profile?.displayName?.trim() || profile?.name?.trim()
  return (
    <div className="space-y-2 rounded-2xl bg-card p-4">
      <p className="font-medium">{t.confirmTitle}</p>
      <div className="flex items-center gap-3">
        <Avatar className="size-12 shrink-0">
          {profile?.picture && <AvatarImage src={profile.picture} alt="" />}
          <AvatarFallback>{npubInitials(pubkey)}</AvatarFallback>
        </Avatar>
        {name && <p className="min-w-0 break-words font-medium">{name}</p>}
      </div>
      <p
        className="break-all font-mono text-xs"
        data-testid="passkey-import-npub"
      >
        {toNpub(pubkey)}
      </p>
      <p className="text-sm text-muted-foreground">{t.confirmBody}</p>
    </div>
  )
}
