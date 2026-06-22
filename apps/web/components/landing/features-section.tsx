'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AtSign,
  Wallet,
  CreditCard,
  Bell,
  Webhook,
  Ticket,
  User,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Feature {
  icon: LucideIcon
  title: string
  description: string
  tags?: string[]
}

const FEATURES: Feature[] = [
  {
    icon: AtSign,
    title: 'Lightning Address',
    description: 'Multiple addresses for multiple purposes — one identity, many ways to use it.',
    tags: ['Redirect', 'Spend', 'Card', 'Lend', 'Tip', 'Share'],
  },
  {
    icon: Wallet,
    title: 'Built-in Wallet',
    description: 'NWC connection with disposable, instant wallets via LNCurl.',
  },
  {
    icon: CreditCard,
    title: 'NFC Cards',
    description: 'Customize and create your own tap-to-pay cards.',
  },
  {
    icon: Bell,
    title: 'Notifications',
    description: 'Wire notifications that fire on the conditions you choose.',
  },
  {
    icon: Webhook,
    title: 'Webhooks',
    description: 'Assign webhook notifications to program your payment flows.',
  },
  {
    icon: Ticket,
    title: 'Memberships',
    description: 'Gated access and perks for your community.',
  },
]

const RADIUS = 156 // px from center to each node

export function FeaturesSection() {
  const [hovered, setHovered] = useState<number | null>(null)
  const [stageHovered, setStageHovered] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  // Mirror `hovered` in a ref so the parallax handler (set up once) can freeze
  // the tilt while a node is focused — otherwise the plane drifts the node out
  // from under the cursor and the hover flickers.
  const hoveredRef = useRef(false)

  // Pointer parallax — rAF-throttled, transform-only via CSS custom props.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let nx = 0
    let ny = 0
    function onMove(e: PointerEvent) {
      if (hoveredRef.current) return // freeze the tilt while a node is focused
      const r = stage!.getBoundingClientRect()
      nx = (e.clientX - r.left) / r.width - 0.5
      ny = (e.clientY - r.top) / r.height - 0.5
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          // 2D translate only — a 3D tilt (rotateX/Y + preserve-3d) breaks
          // pointer hit-testing on the will-change'd orbiting nodes.
          stage!.style.setProperty('--px', `${nx * 22}px`)
          stage!.style.setProperty('--py', `${ny * 22}px`)
        })
      }
    }
    function reset() {
      stage!.style.setProperty('--px', '0px')
      stage!.style.setProperty('--py', '0px')
    }
    stage.addEventListener('pointermove', onMove)
    stage.addEventListener('pointerleave', reset)
    return () => {
      stage.removeEventListener('pointermove', onMove)
      stage.removeEventListener('pointerleave', reset)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const active = hovered != null ? FEATURES[hovered] : null

  return (
    <section className="relative mx-auto max-w-6xl px-4 py-28">
      <div className="mb-3 text-center">
        <span
          className="text-xs font-semibold uppercase tracking-[0.22em]"
          style={{ color: 'var(--theme-400)' }}
        >
          One identity, everything around it
        </span>
      </div>
      <h2 className="mb-4 text-center text-3xl font-bold tracking-tight md:text-5xl">
        What you get
      </h2>
      <p className="mx-auto mb-14 max-w-md text-center text-muted-foreground">
        Your Nostr identity sits at the center. Every feature orbits it — hover
        to explore.
      </p>

      {/* ── Orbital constellation (sm and up) ─────────────────────────────── */}
      <div className="hidden sm:block">
      <div
        ref={stageRef}
        data-paused={stageHovered || hovered != null}
        onPointerEnter={() => setStageHovered(true)}
        onPointerLeave={() => {
          setStageHovered(false)
          setHovered(null)
          hoveredRef.current = false
        }}
        className="orbit-stage relative mx-auto select-none"
        style={{ height: 560, maxWidth: 560 }}
      >
        <div className="orbit-tilt absolute inset-0 flex items-center justify-center">
          {/* ambient theme bloom */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
            style={{
              background:
                'radial-gradient(circle, color-mix(in srgb, var(--theme-400) 18%, transparent), transparent 70%)',
            }}
          />
          {/* decorative orbit rings */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.07]" style={{ width: RADIUS * 2, height: RADIUS * 2 }} />
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/[0.05]" style={{ width: RADIUS * 1.28, height: RADIUS * 1.28 }} />

          {/* center avatar — the Nostr identity */}
          <CenterAvatar dimmed={hovered != null} />

          {/* rotating orbit: spokes + feature nodes */}
          <div className="orbit-spin absolute left-1/2 top-1/2 size-0">
            {FEATURES.map((f, i) => {
              const a = (i / FEATURES.length) * Math.PI * 2 - Math.PI / 2
              const x = Math.cos(a) * RADIUS
              const y = Math.sin(a) * RADIUS
              const state =
                hovered == null ? 'idle' : hovered === i ? 'active' : 'dim'
              return (
                <div key={f.title}>
                  {/* spoke from center to node (rotates with the orbit) */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute top-0 left-0 origin-left"
                    style={{
                      width: RADIUS,
                      height: 2,
                      marginTop: -1,
                      transform: `rotate(${(a * 180) / Math.PI}deg)`,
                      background:
                        state === 'active'
                          ? 'linear-gradient(90deg, color-mix(in srgb, var(--theme-400) 70%, transparent), transparent)'
                          : 'linear-gradient(90deg, color-mix(in srgb, var(--theme-400) 22%, transparent), transparent)',
                      opacity: state === 'dim' ? 0.25 : 1,
                      transition: 'opacity 0.3s, background 0.3s',
                    }}
                  />
                  {/* node, kept upright by the counter-spin */}
                  <div
                    className="absolute top-0 left-0"
                    style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
                  >
                    <div className="orbit-counter">
                      <FeatureNode
                        feature={f}
                        state={state}
                        onEnter={() => {
                          setHovered(i)
                          hoveredRef.current = true
                        }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

      </div>

        <ExpandedCard active={active} />
      </div>

      {/* ── Mobile fallback grid ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:hidden">
        {FEATURES.map(f => (
          <div
            key={f.title}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm"
          >
            <span
              className="flex size-10 items-center justify-center rounded-xl"
              style={{ background: 'color-mix(in srgb, var(--theme-400) 16%, transparent)', color: 'var(--theme-400)' }}
            >
              <f.icon className="size-5" />
            </span>
            <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.description}</p>
            {f.tags && f.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {f.tags.map(t => (
                  <span
                    key={t}
                    className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      background: 'color-mix(in srgb, var(--theme-400) 12%, transparent)',
                      color: 'color-mix(in srgb, var(--theme-400) 80%, white)',
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <style jsx>{`
        .orbit-stage {
          --px: 0px;
          --py: 0px;
        }
        /* 2D translate only — no 3D tilt. A perspective/rotateX/rotateY plane
           with preserve-3d misaligns pointer hit-testing on the orbiting nodes
           (cursor "loses" the node as it moves), so we keep it flat. */
        .orbit-tilt {
          transform: translate(var(--px), var(--py));
          transition: transform 0.3s ease-out;
        }
        .orbit-spin {
          animation: orbit-spin 46s linear infinite;
        }
        .orbit-counter {
          animation: orbit-spin-rev 46s linear infinite;
        }
        /* Pause the whole system while a feature is focused so it reads clearly. */
        .orbit-stage[data-paused='true'] .orbit-spin,
        .orbit-stage[data-paused='true'] .orbit-counter {
          animation-play-state: paused;
        }
        @keyframes orbit-spin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes orbit-spin-rev {
          to {
            transform: rotate(-360deg);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .orbit-spin,
          .orbit-counter {
            animation: none;
          }
          .orbit-tilt {
            transition: none;
          }
        }
      `}</style>
    </section>
  )
}

function CenterAvatar({ dimmed }: { dimmed: boolean }) {
  return (
    <div
      className={cn(
        'absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-300',
        dimmed ? 'opacity-90' : 'opacity-100'
      )}
    >
      <div className="claim-orbit-avatar relative flex size-24 items-center justify-center rounded-full">
        <div
          aria-hidden
          className="claim-orbit-avatar-glow absolute inset-0 -z-10 rounded-full"
        />
        <span className="text-2xl font-semibold text-white/90">
          <User className="size-9" strokeWidth={2} />
        </span>
      </div>
      <style jsx>{`
        .claim-orbit-avatar {
          background:
            linear-gradient(
              160deg,
              rgba(255, 255, 255, 0.12) 0%,
              rgba(255, 255, 255, 0.02) 55%,
              rgba(255, 255, 255, 0) 100%
            ),
            color-mix(in srgb, var(--theme-400) 24%, rgba(12, 12, 16, 0.7));
          border: 1px solid color-mix(in srgb, var(--theme-400) 45%, transparent);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow:
            0 1px 0 0 rgba(255, 255, 255, 0.2) inset,
            0 12px 40px -12px color-mix(in srgb, var(--theme-400) 60%, transparent);
        }
        .claim-orbit-avatar-glow {
          background: radial-gradient(
            circle at 50% 45%,
            color-mix(in srgb, var(--theme-400) 60%, transparent) 0%,
            transparent 70%
          );
          filter: blur(16px);
          animation: avatar-breathe 5s ease-in-out infinite;
        }
        @keyframes avatar-breathe {
          0%,
          100% {
            opacity: 0.5;
            transform: scale(1);
          }
          50% {
            opacity: 0.9;
            transform: scale(1.14);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .claim-orbit-avatar-glow {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}

function FeatureNode({
  feature,
  state,
  onEnter,
  onLeave,
}: {
  feature: Feature
  state: 'idle' | 'active' | 'dim'
  onEnter: () => void
  onLeave?: () => void
}) {
  const Icon = feature.icon
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={cn(
        'group/node flex flex-col items-center gap-2 transition-transform duration-300',
        state === 'active' && 'scale-110',
        state === 'dim' && 'opacity-40'
      )}
    >
      <span
        className={cn(
          'flex size-16 items-center justify-center rounded-2xl border backdrop-blur-md transition-all duration-300',
          state === 'active' ? 'border-white/25' : 'border-white/10'
        )}
        style={{
          background:
            state === 'active'
              ? 'color-mix(in srgb, var(--theme-400) 22%, rgba(16,16,20,0.75))'
              : 'rgba(16,16,20,0.6)',
          boxShadow:
            state === 'active'
              ? '0 12px 36px -10px color-mix(in srgb, var(--theme-400) 70%, transparent), 0 1px 0 0 rgba(255,255,255,0.12) inset'
              : '0 8px 24px -12px rgba(0,0,0,0.7), 0 1px 0 0 rgba(255,255,255,0.06) inset',
        }}
      >
        <Icon
          className="size-7 transition-colors"
          style={{ color: state === 'active' ? 'var(--theme-400)' : 'rgba(255,255,255,0.78)' }}
        />
      </span>
      <span
        className={cn(
          'whitespace-nowrap text-[11px] font-medium transition-colors',
          state === 'active' ? 'text-foreground' : 'text-muted-foreground/70'
        )}
      >
        {feature.title}
      </span>
    </button>
  )
}

function ExpandedCard({ active }: { active: Feature | null }) {
  const Icon = active?.icon ?? User
  return (
    <div className="relative mx-auto -mt-14 flex min-h-[184px] w-[min(34rem,94%)] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[rgba(12,12,16,0.55)] p-6 backdrop-blur-xl">
      {/* specular top edge + theme bloom */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-12 -top-12 size-44 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--theme-400) 16%, transparent), transparent 70%)' }}
      />
      {/* key forces an expand/crossfade as the focused feature changes */}
      <div key={active?.title ?? 'idle'} className="orbit-card-pop relative flex flex-col">
        <div className="flex items-center gap-3.5">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/10"
            style={{ background: 'color-mix(in srgb, var(--theme-400) 18%, transparent)', color: 'var(--theme-400)' }}
          >
            <Icon className="size-6" />
          </span>
          <h3 className="text-xl font-semibold tracking-tight text-foreground">
            {active ? active.title : 'Your Nostr identity'}
          </h3>
        </div>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          {active
            ? active.description
            : 'Hover a feature — everything revolves around your identity.'}
        </p>
        {active?.tags && active.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {active.tags.map(t => (
              <span
                key={t}
                className="rounded-full border border-white/10 px-3 py-1 text-xs font-medium"
                style={{
                  background: 'color-mix(in srgb, var(--theme-400) 12%, transparent)',
                  color: 'color-mix(in srgb, var(--theme-400) 80%, white)',
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <style jsx>{`
        .orbit-card-pop {
          animation: orbit-card-pop 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @keyframes orbit-card-pop {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.97);
            filter: blur(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .orbit-card-pop {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}
