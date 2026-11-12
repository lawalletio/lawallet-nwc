'use client'

import { ArrowRight, AtSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/lib/client/hooks/use-settings'

/**
 * Dashboard empty state for an account without a lightning address: a glowing
 * card that previews the address they're about to claim, plus one CTA.
 */
export function ClaimAddressEmptyState({ onClaim }: { onClaim: () => void }) {
  const { data: settings } = useSettings()
  const domain = settings?.domain?.trim() || 'lawallet.io'

  return (
    <div className="relative isolate mx-auto my-10 w-full max-w-md overflow-hidden rounded-3xl border bg-card px-6 py-12 text-center sm:my-16">
      {/* Accent glow + faint grid, fading out toward the bottom. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,hsl(var(--primary)/0.22),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]"
      />

      <div className="animate-scale-in relative mx-auto mb-8 grid size-20 place-items-center">
        <span className="animate-ring-expand absolute inset-0 rounded-full border-2 border-primary/70" />
        <span
          className="animate-ring-expand absolute inset-0 rounded-full border-2 border-primary/70"
          style={{ animationDelay: '0.8s' }}
        />
        <span className="grid size-20 place-items-center rounded-full border border-(--theme-300) bg-linear-to-b from-(--theme-200) to-(--theme-400) text-foreground shadow-[0_0_48px_hsl(var(--primary)/0.5)]">
          <AtSign className="size-9" strokeWidth={2.5} />
        </span>
      </div>

      {/* The address-to-be, as it will read. */}
      <div
        className="animate-fade-in mx-auto inline-flex max-w-full items-center rounded-2xl border border-border bg-background/80 px-5 py-3 font-mono text-lg shadow-[0_20px_40px_-16px_rgba(0,0,0,0.6)] backdrop-blur sm:text-xl"
        style={{ animationDelay: '0.15s', animationFillMode: 'both' }}
      >
        <span className="text-muted-foreground">you</span>
        <span
          aria-hidden
          className="mx-px h-6 w-0.5 rounded-full bg-primary motion-safe:animate-pulse"
        />
        <span className="truncate text-primary">@{domain}</span>
      </div>

      <h2
        className="animate-fade-in mt-8 text-2xl font-extrabold tracking-tight"
        style={{ animationDelay: '0.3s', animationFillMode: 'both' }}
      >
        Claim your Lightning address
      </h2>

      <div
        className="animate-fade-in mt-8"
        style={{ animationDelay: '0.45s', animationFillMode: 'both' }}
      >
        <Button
          variant="theme"
          className="group h-12 w-full max-w-xs text-base"
          onClick={onClaim}
        >
          Claim now
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Button>
      </div>
    </div>
  )
}
