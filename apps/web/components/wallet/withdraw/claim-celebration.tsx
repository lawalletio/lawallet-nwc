'use client'

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { RotateCcw, Volume2, VolumeX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TreasureChest } from '@/components/wallet/withdraw/treasure-chest'
import { cn } from '@/lib/utils'
import {
  claimCountEase,
  claimCountWindow,
  claimSoundMuted,
  playClaimCelebration,
  setClaimSoundMuted,
  stopClaimSound,
  unlockClaimSound
} from '@/lib/client/claim-sound'
import { useT } from '@/lib/client/i18n'

export interface ClaimBalanceInput {
  /** Balance captured when the user tapped Withdraw. Null if it was unknown. */
  snapshot: number | null
  /** True once the claim click has stored a snapshot (including an unknown one). */
  captured: boolean
  /** Latest wallet balance. May already include the deposit. */
  live: number | null
  amount: number
  settled: boolean
}

/**
 * Picks the balance the animation counts from and to.
 * A number captured at the click is the pre-claim balance. Without one,
 * a settled live balance that can cover the claim is treated as already
 * including it, so the count still climbs by exactly the new sats.
 */
export function resolveClaimBalances({
  snapshot,
  captured,
  live,
  amount,
  settled
}: ClaimBalanceInput): { before: number | null; after: number | null } {
  let before: number | null = null
  if (captured && snapshot != null) {
    before = Math.max(0, snapshot)
  } else if (live != null && settled && live >= amount) {
    before = live - amount
  } else if (live != null) {
    before = Math.max(0, live)
  }
  if (before == null) return { before: null, after: null }
  return { before, after: settled ? before + amount : before }
}

/** How much of the gauge the new sats occupy. Small claims stay visible. */
export function claimPourShare(before: number, added: number): number {
  if (added <= 0) return 0
  if (before <= 0) return 1
  const raw = added / (before + added)
  return Math.min(0.78, Math.max(raw, 0.26))
}

interface ClaimCelebrationProps {
  phase: 'charging' | 'celebrate'
  amountSats: number
  settled: boolean
  snapshot: number | null
  captured: boolean
  liveBalance: number | null
  /** Dev preview only: real claims play once. */
  canReplay?: boolean
  onDone: () => void
  onDismiss: () => void
}

/** Used when the chest never reports a start (Lottie failed to load). */
const FALLBACK_TIMING = { visualSec: 3.9, soundSec: 4.1 }
const FALLBACK_AFTER_MS = 1500

type Stage = 'idle' | 'open' | 'landed'

const fmt = (n: number) => Math.max(0, Math.round(n)).toLocaleString()

/** Writes into the text node React owns, so later renders stay in sync. */
function setText(el: HTMLElement | null, text: string) {
  const node = el?.firstChild
  if (node && node.nodeValue !== text) node.nodeValue = text
}

export function ClaimCelebration({
  phase,
  amountSats,
  settled,
  snapshot,
  captured,
  liveBalance,
  canReplay = false,
  onDone,
  onDismiss
}: ClaimCelebrationProps) {
  const t = useT()
  const c = t.withdraw.celebration
  const reduced = usePrefersReducedMotion()
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const [runId, setRunId] = useState(0)
  const [muted, setMuted] = useState(claimSoundMuted)
  const [locked, setLocked] = useState<{
    before: number | null
    after: number | null
  } | null>(null)

  if (phase === 'celebrate' && locked === null) {
    setLocked(
      resolveClaimBalances({
        snapshot,
        captured,
        live: liveBalance,
        amount: amountSats,
        settled
      })
    )
  }

  const before = locked?.before ?? null
  const after = locked?.after ?? null
  const celebrate = phase === 'celebrate'
  const animate = celebrate && !reduced

  // Sound length of the current run, set when the chest starts playing.
  // Reset during render on replay, before the new clip starts.
  const [soundSec, setSoundSec] = useState(0)
  const [stage, setStage] = useState<Stage>('idle')
  const [stageFor, setStageFor] = useState(runId)
  if (stageFor !== runId) {
    setStageFor(runId)
    setSoundSec(0)
    setStage('idle')
  }
  const startedRun = useRef(-1)

  const amountRef = useRef<HTMLSpanElement>(null)
  const balanceRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  function start(timing: { soundSec: number }) {
    if (startedRun.current === runId) return
    startedRun.current = runId
    setSoundSec(timing.soundSec)
    playClaimCelebration(false, timing.soundSec)
  }

  // The chest drives the clock; if it never loads, run without it.
  useEffect(() => {
    if (!animate || soundSec > 0) return
    const id = setTimeout(() => start(FALLBACK_TIMING), FALLBACK_AFTER_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, soundSec, runId])

  // One rAF loop writes the count, the balance and the bar straight to the
  // DOM, so the numbers move every frame without re-rendering React.
  useEffect(() => {
    if (!animate || soundSec <= 0) return
    const { start: s, end: e } = claimCountWindow(soundSec)
    const startMs = s * 1000
    const spanMs = (e - s) * 1000
    const base = before ?? 0
    const t0 = performance.now()
    let opened = false
    let frame = 0
    const tick = (now: number) => {
      const elapsed = now - t0
      if (!opened && elapsed >= startMs) {
        opened = true
        setStage('open')
      }
      const p = Math.min(1, Math.max(0, (elapsed - startMs) / spanMs))
      const v = claimCountEase(p)
      const gained = amountSats * v
      setText(amountRef.current, fmt(gained))
      if (settled) setText(balanceRef.current, fmt(base + gained))
      if (barRef.current)
        barRef.current.style.transform = `translateX(${(v - 1) * 100}%)`
      if (p < 1) {
        frame = requestAnimationFrame(tick)
      } else {
        setStage('landed')
        navigator.vibrate?.([18, 40, 70])
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [animate, soundSec, runId, amountSats, settled, before])

  useEffect(() => {
    return () => stopClaimSound()
  }, [runId, celebrate])

  useEffect(() => {
    if (!celebrate || !reduced) return
    playClaimCelebration(true)
  }, [celebrate, reduced, runId])

  const final = !animate || stage === 'landed'
  const amountText = final ? fmt(amountSats) : '0'
  const balanceShown = !celebrate
    ? liveBalance
    : before == null
      ? null
      : final
        ? after
        : before
  const pour = before == null ? 1 : claimPourShare(before, amountSats)
  const opened = !animate || stage !== 'idle'
  const landed = celebrate && final

  function replay() {
    unlockClaimSound()
    setRunId(id => id + 1)
  }

  function toggleMute() {
    const next = !muted
    setMuted(next)
    setClaimSoundMuted(next)
    if (!next && celebrate) replay()
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-80 flex justify-center bg-[#070604] text-amber-50">
      <div className="relative flex h-full w-full max-w-md flex-col overflow-hidden">
        <VaultAtmosphere glow={celebrate && opened} />
        <div className="pointer-events-none absolute inset-0 z-0 flex -translate-y-24 items-center justify-center">
          <div className={cn(!celebrate && !reduced && 'claim-wobble')}>
            <TreasureChest
              play={animate}
              reduced={reduced}
              runId={runId}
              onStart={animate ? start : undefined}
            />
          </div>
          {animate && stage !== 'idle' && <CoinBurst key={runId} />}
        </div>
        <header className="relative z-10 flex items-center justify-between px-3 pt-3">
          <button
            type="button"
            onClick={celebrate ? onDone : onDismiss}
            aria-label={celebrate ? t.common.close : t.common.back}
            className="flex size-11 items-center justify-center rounded-2xl text-amber-100/80 transition-colors hover:bg-white/5"
          >
            <X className="size-5" />
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={muted || claimSoundMuted()}
            aria-label={muted ? c.unmute : c.mute}
            className="flex size-11 items-center justify-center rounded-2xl text-amber-100/80 transition-colors hover:bg-white/5"
          >
            {muted ? (
              <VolumeX className="size-5" />
            ) : (
              <Volume2 className="size-5" />
            )}
          </button>
        </header>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-5 pb-6 text-center">
          <div
            key={`${phase}-${runId}`}
            className={cn(
              'flex flex-col items-center',
              animate && !opened && 'opacity-0',
              animate && opened && 'claim-rise'
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-amber-200/70">
              {celebrate ? c.eyebrowClaimed : c.eyebrowClaiming}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-amber-50">
              {celebrate ? (settled ? c.won : c.onItsWay) : c.opening}
            </h1>
            {!(celebrate && settled) && (
              <p className="mt-1 max-w-xs text-sm text-amber-100/60">
                {celebrate
                  ? c.pendingBody
                  : c.calling(amountSats.toLocaleString())}
              </p>
            )}
          </div>

          <div
            key={`amount-${runId}`}
            className={cn(
              'flex flex-1 items-end justify-center pb-2',
              !celebrate || (animate && !opened)
                ? 'invisible'
                : animate && 'claim-rise'
            )}
          >
            <div
              key={landed ? `pop-${runId}` : 'count'}
              className={cn(
                'relative flex items-baseline justify-center gap-2',
                landed && animate && 'claim-pop'
              )}
            >
              {landed && animate && <LandingGlints />}
              <span
                aria-hidden
                className="claim-gold text-[clamp(2.8rem,13vw,4.6rem)] font-bold leading-none tabular-nums"
              >
                +<span ref={amountRef}>{amountText}</span>
              </span>
              <span className="text-lg font-medium text-amber-200/80">
                sats
              </span>
            </div>
          </div>
          <p className="sr-only">
            {settled
              ? c.srLanded(amountSats.toLocaleString())
              : c.srOnTheWay(amountSats.toLocaleString())}
          </p>

          <BalanceCard
            balance={balanceShown}
            balanceRef={balanceRef}
            barRef={barRef}
            before={celebrate ? before : null}
            hasBase={celebrate ? before != null : liveBalance != null}
            pour={pour}
            filled={celebrate && final}
            settled={settled && celebrate}
            pending={!celebrate}
            flowing={animate && stage === 'open'}
            landed={landed}
            amountSats={amountSats}
          />

          <div className="mt-5 flex w-full flex-col gap-2">
            {celebrate ? (
              <>
                <Button
                  type="button"
                  onClick={onDone}
                  className="h-12 w-full bg-linear-to-b from-amber-300 to-amber-500 text-base font-semibold text-amber-950 shadow-[0_8px_30px_-8px_rgba(251,191,36,0.7)] hover:from-amber-200 hover:to-amber-400"
                >
                  {c.collect}
                </Button>
                {canReplay && (
                  <button
                    type="button"
                    onClick={replay}
                    className="inline-flex items-center justify-center gap-1.5 py-1 text-sm text-amber-200/70 underline-offset-4 hover:underline"
                  >
                    <RotateCcw className="size-3.5" />
                    {c.replay}
                  </button>
                )}
              </>
            ) : (
              <p className="claim-listening py-6 text-xs uppercase tracking-[0.22em] text-amber-200/50">
                {c.listening}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function VaultAtmosphere({ glow }: { glow: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 38%, rgba(56,189,248,0.16), transparent 46%), radial-gradient(ellipse at 50% 100%, rgba(255,186,72,0.12), transparent 42%)'
        }}
      />
      <div
        className="absolute inset-0 transition-opacity duration-700"
        style={{
          opacity: glow ? 1 : 0,
          background:
            'radial-gradient(circle at 50% 34%, rgba(255,214,107,0.22), transparent 42%)'
        }}
      />
    </div>
  )
}

// Fixed spray so every replay looks the same and render stays pure.
const COINS = Array.from({ length: 22 }, (_, i) => {
  const jitter = Math.sin(i * 12.9898) * 0.5 + 0.5
  const angle = ((-90 + (jitter - 0.5) * 150) * Math.PI) / 180
  const dist = 150 + ((i * 37) % 120)
  return {
    dx: Math.round(Math.cos(angle) * dist),
    dy: Math.round(Math.sin(angle) * dist),
    fall: 360 + ((i * 53) % 140),
    rot: (i % 2 ? 1 : -1) * (240 + ((i * 71) % 300)),
    size: 14 + ((i * 7) % 12),
    delay: (i % 11) * 0.08 + Math.floor(i / 11) * 0.45,
    dur: 1.35 + ((i * 13) % 50) / 100
  }
})

function CoinBurst() {
  return (
    <div aria-hidden className="absolute left-1/2 top-1/2 size-0 translate-y-4">
      <span className="claim-flash" />
      {COINS.map((c, i) => (
        <span
          key={i}
          className="claim-coin"
          style={
            {
              '--dx': `${c.dx}px`,
              '--dy': `${c.dy}px`,
              '--fall': `${c.fall}px`,
              '--r': `${c.rot}deg`,
              '--size': `${c.size}px`,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.dur}s`
            } as CSSProperties
          }
        >
          <span className="claim-coin-face" />
        </span>
      ))}
    </div>
  )
}

const GLINTS = Array.from({ length: 10 }, (_, i) => {
  const angle = (i / 10) * Math.PI * 2 + 0.3
  const dist = 70 + (i % 3) * 22
  return {
    dx: Math.round(Math.cos(angle) * dist * 1.5),
    dy: Math.round(Math.sin(angle) * dist * 0.8),
    size: 8 + (i % 3) * 4
  }
})

function LandingGlints() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 size-0"
    >
      <span className="claim-halo" />
      {GLINTS.map((g, i) => (
        <span
          key={i}
          className="claim-glint"
          style={
            {
              '--dx': `${g.dx}px`,
              '--dy': `${g.dy}px`,
              '--size': `${g.size}px`,
              animationDelay: `${(i % 4) * 0.04}s`
            } as CSSProperties
          }
        />
      ))}
    </span>
  )
}

function BalanceCard({
  balance,
  balanceRef,
  barRef,
  before,
  hasBase,
  pour,
  filled,
  settled,
  pending,
  flowing,
  landed,
  amountSats
}: {
  balance: number | null
  balanceRef: RefObject<HTMLSpanElement | null>
  barRef: RefObject<HTMLDivElement | null>
  before: number | null
  hasBase: boolean
  pour: number
  filled: boolean
  settled: boolean
  pending: boolean
  flowing: boolean
  landed: boolean
  amountSats: number
}) {
  const c = useT().withdraw.celebration
  const share = hasBase ? pour : 1
  const base = hasBase ? (1 - share) * 100 : 0
  return (
    <section
      className={cn(
        'mt-5 w-full rounded-3xl border bg-black/35 px-4 py-3 text-left transition-colors duration-700',
        landed && settled ? 'border-amber-300/40' : 'border-amber-200/15'
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-200/60">
          {c.balance}
        </p>
        {pending ? (
          <p className="text-xs text-amber-200/70">{c.holding}</p>
        ) : !settled ? (
          <p className="text-xs text-amber-200/70">{c.pending}</p>
        ) : landed ? (
          <p className="claim-chip rounded-full bg-amber-300/15 px-2 py-0.5 text-xs font-semibold text-amber-200">
            +{amountSats.toLocaleString()} sats
          </p>
        ) : null}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        {balance == null ? (
          <span className="text-2xl font-semibold text-amber-100/80">
            {c.syncing}
          </span>
        ) : (
          <span
            ref={balanceRef}
            className="text-2xl font-semibold tabular-nums text-amber-50"
          >
            {balance.toLocaleString()}
          </span>
        )}
        <span className="text-sm text-amber-200/60">sats</span>
      </div>
      <div
        className={cn(
          'claim-track mt-3 flex h-4 gap-[3px] rounded-full p-[3px]',
          landed && settled && 'is-landed'
        )}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(base + (filled ? share * 100 : 0))}
        aria-label={c.meter}
      >
        {base > 0 && (
          <div
            className="claim-track-base h-full rounded-full"
            style={{ flex: base }}
          />
        )}
        <div
          className="relative h-full overflow-hidden rounded-full"
          style={{ flex: share * 100 }}
        >
          <div
            ref={barRef}
            className={cn(
              'claim-fill absolute inset-0 rounded-full',
              flowing && 'is-flowing',
              landed && settled && 'is-landed',
              !settled && 'opacity-55'
            )}
            style={{ transform: `translateX(${filled ? 0 : -100}%)` }}
          />
        </div>
      </div>
      {before != null && (
        <div className="mt-2 flex items-center justify-between text-[11px] tabular-nums text-amber-200/50">
          <span className="flex items-center gap-1.5">
            <span className="claim-track-base size-1.5 rounded-full" />
            {c.before(before.toLocaleString())}
          </span>
          <span className="flex items-center gap-1.5 text-amber-200/80">
            <span className="size-1.5 rounded-full bg-amber-300" />
            {c.claimed(amountSats.toLocaleString())}
          </span>
        </div>
      )}
    </section>
  )
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}
