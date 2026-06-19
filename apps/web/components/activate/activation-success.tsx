'use client'

import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card3D } from '@/components/activate/card-3d'

// The lead confetti colour follows the community's theme (--primary, set from
// settings); the rest stay as festive accents.
const CONFETTI_COLORS = ['hsl(var(--primary))', '#F5A623', '#E53935', '#A78BFA', '#ffffff']

/**
 * Celebration screen shown after a successful claim: confetti rain, an
 * expanding success ring + drawn checkmark, the activated card, and a CTA into
 * the wallet. Pure CSS animation — pieces are seeded deterministically per
 * index so there's no hydration mismatch.
 */
export function ActivationSuccess({
  imageUrl,
  title
}: {
  imageUrl?: string | null
  title?: string
}) {
  const router = useRouter()

  const confetti = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        // Deterministic pseudo-random from the index — no Math.random so SSR and
        // client agree.
        const r = (n: number) => ((Math.sin(i * 9301 + n * 49297) + 1) / 2) % 1
        return {
          left: `${Math.round(r(1) * 100)}%`,
          delay: `${(r(2) * 1.2).toFixed(2)}s`,
          duration: `${(2.2 + r(3) * 1.8).toFixed(2)}s`,
          dx: `${Math.round((r(4) - 0.5) * 220)}px`,
          rot: `${Math.round(360 + r(5) * 900)}deg`,
          size: 6 + Math.round(r(6) * 7),
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          round: r(7) > 0.5
        }
      }),
    []
  )

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden text-center">
      {/* confetti layer */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {confetti.map((c, i) => (
          <span
            key={i}
            className="absolute top-0 block"
            style={{
              left: c.left,
              width: c.size,
              height: c.size,
              background: c.color,
              borderRadius: c.round ? '9999px' : '2px',
              animation: `confetti-fall ${c.duration} linear ${c.delay} forwards`,
              ['--dx' as string]: c.dx,
              ['--rot' as string]: c.rot
            }}
          />
        ))}
      </div>

      {/* success badge with expanding rings — themed via the settings-driven
          --primary / --theme-* tokens (same accent the theme Button uses). */}
      <div className="animate-success-pop relative mb-8 grid size-24 place-items-center">
        <span className="animate-ring-expand absolute inset-0 rounded-full border-2 border-primary" />
        <span
          className="animate-ring-expand absolute inset-0 rounded-full border-2 border-primary"
          style={{ animationDelay: '0.6s' }}
        />
        <span
          className="grid size-20 place-items-center rounded-full border border-[var(--theme-300)] bg-gradient-to-b from-[var(--theme-200)] to-[var(--theme-400)] text-foreground"
          style={{ boxShadow: '0 0 36px hsl(var(--primary) / 0.55)' }}
        >
          <svg viewBox="0 0 52 52" className="size-10" fill="none">
            <path
              d="M14 27 L23 36 L39 18"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: 48,
                strokeDashoffset: 48,
                animation: 'draw-check 0.5s ease-out 0.35s forwards'
              }}
            />
          </svg>
        </span>
      </div>

      <h1 className="animate-fade-in text-2xl font-semibold text-foreground">
        Card activated!
      </h1>
      <p className="animate-fade-in mt-2 max-w-xs text-sm text-muted-foreground">
        {title ? (
          <>
            <span className="font-medium text-foreground">{title}</span> is now
            linked to your wallet and ready to tap-to-pay.
          </>
        ) : (
          'Your card is now linked to your wallet and ready to tap-to-pay.'
        )}
      </p>

      <div className="my-8 scale-90">
        <Card3D imageUrl={imageUrl} title={title} glow={false} />
      </div>

      <Button
        className="h-12 w-full max-w-xs"
        onClick={() => router.push('/wallet')}
      >
        Open wallet
      </Button>
    </div>
  )
}
