'use client'

import Image from 'next/image'
import { useBrandLogotypes } from '@/lib/client/hooks/use-brand'
import packageJson from '../../package.json'

// Resolved at build time from `apps/web/package.json` so a release bump flows
// through without editing this file.
const APP_VERSION = packageJson.version

/**
 * Full-screen branded loading state shown while the wallet hydrates. Replaces
 * the bare spinner with the community isotype, an indeterminate progress bar,
 * and the app version — so a cold launch reads as "the app is starting" rather
 * than a generic wait.
 */
export function WalletLoadingScreen() {
  const { isotypo } = useBrandLogotypes()

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-8">
      <div className="relative flex size-20 items-center justify-center overflow-hidden rounded-3xl bg-card">
        <Image
          src={isotypo}
          alt=""
          fill
          sizes="80px"
          className="object-contain p-3"
          unoptimized
          priority
        />
      </div>

      <div
        role="progressbar"
        aria-label="Loading"
        className="h-1 w-40 overflow-hidden rounded-full bg-card"
      >
        <div className="h-full w-1/3 rounded-full bg-[var(--theme-300)] animate-progress-indeterminate" />
      </div>

      <p className="text-xs text-muted-foreground">v{APP_VERSION}</p>
    </div>
  )
}
