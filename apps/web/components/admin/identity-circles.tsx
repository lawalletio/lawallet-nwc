'use client'

import Image from 'next/image'
import { AtSign } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/components/admin/auth-context'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import { useBrandLogotypes } from '@/lib/client/hooks/use-brand'
import { cn } from '@/lib/utils'

interface IdentityCirclesProps {
  className?: string
  /**
   * Per-circle diameter. Defaults to 64/80 (mobile/desktop). The avatar
   * fallback text size scales with this via the base Avatar component.
   */
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_CLASSES: Record<Required<IdentityCirclesProps>['size'], string> = {
  sm: 'size-12 sm:size-14',
  md: 'size-16 sm:size-20',
  lg: 'size-20 sm:size-24',
}

// The @ circle reads as a connector between the two identity discs, so
// it's visually de-emphasized — about 60% of the outer circles' diameter.
const CONNECTOR_SIZE_CLASSES: Record<Required<IdentityCirclesProps>['size'], string> = {
  sm: 'size-8 sm:size-9',
  md: 'size-10 sm:size-12',
  lg: 'size-12 sm:size-14',
}

/**
 * Three-circle identity badge: the signed-in user's avatar, an @ symbol,
 * and the community's isotypo. Visualizes "you@community" as a glance so
 * the admin home doesn't lead with a generic header — who you are and
 * which deployment you're on is the first thing you see.
 *
 * All three circles are the same diameter; the @ sits in the middle as a
 * peer rather than a small separator so the trio reads as a visual
 * equation. Community isotypo falls back to the static LaWallet mark when
 * the operator hasn't uploaded their own (see useBrandLogotypes).
 */
export function IdentityCircles({
  className,
  size = 'md',
}: IdentityCirclesProps) {
  const { pubkey } = useAuth()
  const { profile } = useNostrProfile(pubkey)
  const { isotypo } = useBrandLogotypes()

  const displayName =
    profile?.displayName || profile?.name || (pubkey ? pubkey.slice(0, 8) : '')
  const avatarFallback = (
    profile?.name?.[0] ||
    profile?.displayName?.[0] ||
    pubkey?.slice(0, 2) ||
    '?'
  )
    .slice(0, 2)
    .toUpperCase()

  const sizeClass = SIZE_CLASSES[size]
  const connectorSizeClass = CONNECTOR_SIZE_CLASSES[size]

  return (
    <div className={cn('flex items-center justify-center gap-4 sm:gap-5', className)}>
      <Avatar className={cn(sizeClass, 'ring-2 ring-border')}>
        {profile?.picture && <AvatarImage src={profile.picture} alt={displayName} />}
        <AvatarFallback>{avatarFallback}</AvatarFallback>
      </Avatar>

      <div
        className={cn(
          connectorSizeClass,
          'flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-border',
        )}
        aria-hidden
      >
        <AtSign className="size-1/2" />
      </div>

      <div
        className={cn(
          sizeClass,
          'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-card ring-2 ring-border',
        )}
      >
        <Image
          src={isotypo}
          alt="Community isotypo"
          fill
          sizes="96px"
          className="object-contain p-2"
        />
      </div>
    </div>
  )
}
