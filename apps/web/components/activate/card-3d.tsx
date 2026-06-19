'use client'

import { cn } from '@/lib/utils'

/**
 * A 3D BoltCard in perspective that gently sways so its design face always
 * stays toward the viewer — it never flips fully, so there's no (fake) back
 * face. Three nested layers each own one transform so the animations compose
 * cleanly:
 *   scene → perspective
 *   tilt  → fixed rotateX (a lifelike off-axis angle)
 *   bob   → translateY float
 *   sway  → small oscillating rotateY (preserve-3d)
 */
export function Card3D({
  imageUrl,
  title,
  className,
  glow = true
}: {
  imageUrl?: string | null
  title?: string
  className?: string
  glow?: boolean
}) {
  return (
    <div className={cn('relative grid place-items-center', className)}>
      {glow && (
        <div
          aria-hidden
          className="animate-activate-glow pointer-events-none absolute size-64 rounded-full blur-3xl"
          style={{
            // Themed glow — follows the community's --primary (set from settings).
            background:
              'radial-gradient(circle, hsl(var(--primary) / 0.5) 0%, hsl(var(--primary) / 0.2) 45%, transparent 70%)'
          }}
        />
      )}

      {/* scene: perspective */}
      <div className="relative" style={{ perspective: '1200px' }}>
        {/* tilt: fixed off-axis angle */}
        <div style={{ transform: 'rotateX(8deg)', transformStyle: 'preserve-3d' }}>
          {/* bob: vertical float */}
          <div className="animate-card-bob" style={{ transformStyle: 'preserve-3d' }}>
            {/* sway: small oscillating rotateY keeps the design facing front */}
            <div
              className="animate-card-sway relative"
              style={{
                width: '300px',
                height: '189px',
                transformStyle: 'preserve-3d'
              }}
            >
              {/* Front (design) face — the only face; the card just sways. */}
              <div className="absolute inset-0 overflow-hidden rounded-2xl border border-white/15 shadow-3xl">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={title || 'Card design'}
                    className="size-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div
                    className="size-full"
                    style={{
                      background:
                        'linear-gradient(135deg, #1c2530 0%, #0a0a0f 55%, #26100a 100%)'
                    }}
                  />
                )}
                {/* readability + title */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
                  {title && (
                    <span className="text-sm font-semibold tracking-wide text-white drop-shadow">
                      {title}
                    </span>
                  )}
                </div>
                {/* specular sheen */}
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div
                    className="animate-glare absolute -inset-y-4 left-1/2 w-1/3"
                    style={{
                      background:
                        'linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent)'
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
