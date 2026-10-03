'use client'

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { Volume2, VolumeX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TreasureChest } from '@/components/wallet/withdraw/treasure-chest'
import { cn } from '@/lib/utils'
import {
  claimSoundMuted,
  playClaimCelebration,
  setClaimSoundMuted,
  stopClaimSound,
  unlockClaimSound
} from '@/lib/client/claim-sound'

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
  onDone: () => void
  onDismiss: () => void
}

export function ClaimCelebration({
  phase,
  amountSats,
  settled,
  snapshot,
  captured,
  liveBalance,
  onDone,
  onDismiss
}: ClaimCelebrationProps) {
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

  // Set when the Lottie actually starts, so the count and the sound share
  // its clock. Reset during render on replay, before the new clip starts.
  const [spanMs, setSpanMs] = useState(0)
  const [spanFor, setSpanFor] = useState(runId)
  if (spanFor !== runId) {
    setSpanFor(runId)
    setSpanMs(0)
  }
  const clockOn = spanMs > 0 && animate
  // One clock for the claimed amount, the balance, and the bar.
  const clock = useEasedClock({
    duration: Math.max(1, spanMs),
    run: clockOn,
    runId
  })
  const gained = clock.done
    ? amountSats
    : clockOn
      ? Math.round(amountSats * clock.t)
      : 0
  const claimed = gained
  const balance = before == null ? null : before + (settled ? gained : 0)
  const fillDone = clock.done

  useEffect(() => {
    return () => stopClaimSound()
  }, [runId, celebrate])

  function handleChestStart(timing: { visualSec: number; soundSec: number }) {
    setSpanMs(Math.max(400, Math.round(timing.visualSec * 1000)))
    playClaimCelebration(false, timing.soundSec)
  }

  useEffect(() => {
    if (!celebrate || !reduced) return
    playClaimCelebration(true)
  }, [celebrate, reduced, runId])

  const claimedShown = !animate ? amountSats : clockOn ? claimed : 0
  const balanceShown = !celebrate
    ? liveBalance
    : before == null
      ? null
      : !animate
        ? after
        : clockOn
          ? balance
          : before
  const balanceProgress = !animate || clock.done ? 1 : clock.t
  const pour = before == null ? 1 : claimPourShare(before, amountSats)

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
    <div className="fixed inset-0 z-[80] flex justify-center bg-[#070604] text-amber-50">
      <div className="relative flex h-full w-full max-w-md flex-col overflow-hidden">
        <VaultAtmosphere />
        <div className="pointer-events-none absolute inset-0 z-0 flex -translate-y-24 items-center justify-center">
          <TreasureChest
            play={animate}
            reduced={reduced}
            runId={runId}
            onStart={animate ? handleChestStart : undefined}
          />
        </div>
        <header className="relative z-10 flex items-center justify-between px-3 pt-3">
          <button
            type="button"
            onClick={celebrate ? onDone : onDismiss}
            aria-label={celebrate ? 'Close' : 'Back'}
            className="flex size-11 items-center justify-center rounded-2xl text-amber-100/80 transition-colors hover:bg-white/5"
          >
            <X className="size-5" />
          </button>
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={muted || claimSoundMuted()}
            aria-label={muted ? 'Unmute claim sound' : 'Mute claim sound'}
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-amber-200/70">
            Lightning claim
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-amber-50">
            {celebrate
              ? settled
                ? 'Funds received'
                : 'Withdraw requested'
              : 'Opening the vault'}
          </h1>
          <p className="mt-1 max-w-xs text-sm text-amber-100/60">
            {celebrate
              ? settled
                ? 'Sats struck the chest and poured into your balance.'
                : "The claim is in. They'll join your balance once the sender pays."
              : `Calling ${amountSats.toLocaleString()} sats down the lightning.`}
          </p>

          <div className="flex flex-1 items-end justify-center pb-2">
            <div className="flex items-baseline justify-center gap-2">
              <OdometerNumber
                value={claimedShown}
                roll={animate}
                className="text-[clamp(2.6rem,12vw,4.4rem)] font-semibold leading-none text-[#ffe7a3] drop-shadow-[0_2px_16px_rgba(0,0,0,0.9)]"
              />
              <span className="text-lg text-amber-200/70">sats</span>
            </div>
          </div>
          <p className="sr-only">
            {settled
              ? `${amountSats.toLocaleString()} sats landed in your wallet.`
              : `${amountSats.toLocaleString()} sats are on the way.`}
          </p>

          <BalanceCrucible
            before={celebrate ? before : liveBalance}
            shown={balanceShown}
            pour={pour}
            progress={celebrate ? balanceProgress : 0.18}
            settled={settled && celebrate}
            pending={!celebrate}
            flowing={!fillDone}
            amountSats={amountSats}
          />

          <div className="mt-5 flex w-full flex-col gap-2">
            {celebrate ? (
              <>
                <Button type="button" onClick={onDone} className="h-12 w-full">
                  Done
                </Button>
                <button
                  type="button"
                  onClick={replay}
                  className="py-1 text-sm text-amber-200/70 underline-offset-4 hover:underline"
                >
                  Replay the strike
                </button>
              </>
            ) : (
              <p className="py-6 text-xs uppercase tracking-[0.22em] text-amber-200/50">
                Listening for the payment
              </p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function VaultAtmosphere() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 38%, rgba(56,189,248,0.16), transparent 46%), radial-gradient(ellipse at 50% 100%, rgba(255,186,72,0.12), transparent 42%)'
        }}
      />
    </div>
  )
}

function BalanceCrucible({
  before,
  shown,
  pour,
  progress,
  settled,
  pending,
  flowing,
  amountSats
}: {
  before: number | null
  shown: number | null
  pour: number
  progress: number
  settled: boolean
  pending: boolean
  flowing: boolean
  amountSats: number
}) {
  const share = before == null ? 1 : pour
  const base = before != null ? (1 - share) * 100 : 0
  const added = share * progress * 100
  return (
    <section className="mt-5 w-full rounded-3xl border border-amber-200/15 bg-black/35 px-4 py-3 text-left">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-200/60">
          Balance
        </p>
        <p className="text-xs text-amber-200/70">
          {pending
            ? 'Holding'
            : settled
              ? `+${amountSats.toLocaleString()} sats`
              : 'Pending'}
        </p>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        {shown == null ? (
          <span className="text-2xl font-semibold text-amber-100/80">
            Syncing
          </span>
        ) : (
          <OdometerNumber
            value={shown}
            roll={!pending}
            className="text-2xl font-semibold text-amber-50"
          />
        )}
        <span className="text-sm text-amber-200/60">sats</span>
      </div>
      <div
        className="mt-3 h-3 overflow-hidden rounded-full bg-white/10"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(base + added)}
        aria-label="Balance filling with claimed sats"
      >
        <div className="flex h-full w-full">
          <div
            className="h-full shrink-0 bg-amber-800/80"
            style={{ width: `${base}%` }}
          />
          <div
            className={cn(
              'h-full shrink-0 claim-pour',
              flowing && 'is-flowing',
              !settled && 'opacity-55'
            )}
            style={{ width: `${added}%` }}
          />
        </div>
      </div>
    </section>
  )
}

const REEL_CELLS = 20

function OdometerNumber({
  value,
  roll,
  className
}: {
  value: number
  roll: boolean
  className?: string
}) {
  const safe = Math.max(0, Math.floor(value))
  const places = Math.max(1, String(safe).length)
  const nodes: ReactNode[] = []
  for (let place = places - 1; place >= 0; place--) {
    nodes.push(
      <OdometerReel
        key={place}
        ticks={Math.floor(safe / 10 ** place)}
        roll={roll}
      />
    )
    if (place % 3 === 0 && place !== 0) {
      nodes.push(<span key={`c-${place}`}>,</span>)
    }
  }
  return (
    <span
      className={cn('inline-flex items-baseline tabular-nums', className)}
      aria-hidden
    >
      {nodes}
    </span>
  )
}

/**
 * One decimal place. `ticks` is how many times this digit has advanced
 * (ones = the number, tens = floor(n/10), …). The reel only travels
 * upward; 9 rolls into the next 0 instead of jumping back.
 */
function OdometerReel({ ticks, roll }: { ticks: number; roll: boolean }) {
  const reelRef = useRef<HTMLSpanElement>(null)
  const posRef = useRef(ticks % 10)
  const ticksRef = useRef(ticks)

  useEffect(() => {
    const reel = reelRef.current
    if (!reel) return

    const move = (pos: number, animate: boolean) => {
      reel.style.transition = animate ? 'transform 0.16s linear' : 'none'
      reel.style.transform = `translateY(-${pos}em)`
      posRef.current = pos
    }

    const delta = ticks - ticksRef.current
    ticksRef.current = ticks

    if (!roll || delta <= 0) {
      move(ticks % 10, false)
      return
    }

    let steps = delta % 10
    if (steps === 0) steps = 10
    const from = posRef.current % 10
    move(from, false)
    void reel.offsetHeight
    move(from + steps, true)
  }, [ticks, roll])

  return (
    <span className="claim-odo">
      <span className="claim-odo-strut">0</span>
      <span
        ref={reelRef}
        className="claim-odo-reel"
        style={{ transform: `translateY(-${ticks % 10}em)` }}
      >
        {Array.from({ length: REEL_CELLS }, (_, i) => (
          <span key={i} className="claim-odo-num">
            {i % 10}
          </span>
        ))}
      </span>
    </span>
  )
}

/** Shared 0–1 clock. Linear so the count and the bar advance at one pace. */
function useEasedClock(opts: {
  duration: number
  run: boolean
  runId: number
}): { t: number; done: boolean } {
  const { duration, run, runId } = opts
  const [t, setT] = useState(run ? 0 : 1)
  const [done, setDone] = useState(!run)
  const [stamp, setStamp] = useState({ run, runId })
  if (stamp.run !== run || stamp.runId !== runId) {
    setStamp({ run, runId })
    setT(run ? 0 : 1)
    setDone(!run)
  }

  useEffect(() => {
    if (!run) return
    const startAt = performance.now()
    let frame = 0
    let lastCommit = 0
    const tick = (now: number) => {
      const linear = Math.min(1, (now - startAt) / duration)
      if (linear >= 1 || now - lastCommit >= 170) {
        setT(linear)
        lastCommit = now
      }
      if (linear < 1) frame = requestAnimationFrame(tick)
      else setDone(true)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [duration, run, runId])

  return { t, done }
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
