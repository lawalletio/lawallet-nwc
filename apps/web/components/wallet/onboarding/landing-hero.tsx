'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { useBrandLogotypes } from '@/lib/client/hooks/use-brand'
import { useT } from '@/lib/client/i18n'

/**
 * Unauthenticated landing for `/wallet`. Mirrors the Figma frame
 * `3052:4308` — community isotype, community name, short description, and
 * two stacked CTAs (Create account / Login).
 */
export function LandingHero() {
  const { isotypo } = useBrandLogotypes()
  const t = useT().onboarding.landing
  const { data: settings } = useSettings()
  const communityName = settings?.community_name?.trim() || 'LaWallet'

  return (
    <div className="flex flex-1 flex-col pb-6 pt-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div className="relative size-40 overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
          <Image
            src={isotypo}
            alt={communityName}
            fill
            className="object-contain p-6"
            priority
            unoptimized
          />
        </div>

        <div className="space-y-3 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            {communityName}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t.tagline}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <Button asChild variant="theme" className="h-12 w-full">
          <Link href="/wallet/signup">{t.createAccount}</Link>
        </Button>
        <Button asChild variant="secondary" className="h-12 w-full">
          <Link href="/wallet/login">{t.login}</Link>
        </Button>
      </div>
    </div>
  )
}
