'use client'

import { BadgeCheck } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { CopyButton } from '@/components/ui/copy-button'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import { npubInitials, toNpub, truncateNpub } from '@/lib/client/format'
import { cn } from '@/lib/utils'

/**
 * Avatar + name for a pubkey that is **not** an account on this instance —
 * a merchant or a coupon-manager service.
 *
 * `useNostrProfile` resolves these because `resolveProfiles` treats a pubkey
 * stored on a Voucher row as resolvable (see lib/nostr/profile-cache.ts). If
 * the relays have nothing, the truncated npub is the name; the key itself is
 * always the ground truth, so it stays copyable either way.
 */
export function NpubIdentity({
  pubkey,
  role,
  className
}: {
  pubkey: string
  role: string
  className?: string
}) {
  const { profile } = useNostrProfile(pubkey)
  const npub = toNpub(pubkey)
  const name = profile?.displayName || profile?.name || truncateNpub(pubkey)

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-card p-3',
        className
      )}
    >
      <Avatar className="size-10 shrink-0">
        {profile?.picture ? <AvatarImage src={profile.picture} alt="" /> : null}
        <AvatarFallback className="text-xs">
          {npubInitials(pubkey)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {role}
        </p>
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          <span className="truncate">{name}</span>
          {profile?.nip05 ? (
            <BadgeCheck
              className="size-4 shrink-0 text-muted-foreground"
              aria-label={`Verified as ${profile.nip05}`}
            />
          ) : null}
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {truncateNpub(pubkey, 10)}
        </p>
      </div>

      <CopyButton value={npub} label={`${role} npub`} />
    </div>
  )
}
