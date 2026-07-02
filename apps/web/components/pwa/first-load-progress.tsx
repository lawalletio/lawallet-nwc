'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { usePathname } from 'next/navigation'

// Resources whose readiness drives the first-load bar. The home screen is the
// usual entry point and reports all three; other entry routes only wait on
// `auth` (plus a short settle timer) so the bar always completes.
export type ProgressStep = 'auth' | 'profile' | 'balance'

const HOME_STEPS: ProgressStep[] = ['auth', 'profile', 'balance']
const OTHER_STEPS: ProgressStep[] = ['auth']

// Visible from the first paint so the user sees immediate feedback.
const BASELINE = 8
// Hard cap: force-complete if something never reports, so the bar never sticks.
const MAX_WAIT_MS = 4000
const SESSION_KEY = 'lawallet:first-load-done'

interface ProgressContextValue {
  report: (step: ProgressStep) => void
}

const ProgressContext = createContext<ProgressContextValue>({ report: () => {} })

/** Report a first-load milestone. No-op after the first load completes. */
export function useFirstLoadProgress() {
  return useContext(ProgressContext)
}

function alreadyLoaded(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function FirstLoadProgressProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? ''
  const expected = useMemo(
    () => (pathname === '/wallet' ? HOME_STEPS : OTHER_STEPS),
    // Only the entry path matters; later navigations use the trickle, not steps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Start unarmed/hidden so SSR and the client's first render agree (reading
  // sessionStorage during render would cause a hydration mismatch). The arming
  // decision happens in a mount effect below.
  const [armed, setArmed] = useState(false)
  const [visible, setVisible] = useState(false)
  const [progress, setProgress] = useState(BASELINE)
  const reported = useRef<Set<ProgressStep>>(new Set())
  const [tick, setTick] = useState(0)
  const finished = useRef(false)

  // Arm the bar after mount, only on the first load of the session.
  useEffect(() => {
    if (!alreadyLoaded()) {
      setArmed(true)
      setVisible(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    try {
      sessionStorage.setItem(SESSION_KEY, '1')
    } catch {
      // sessionStorage may be unavailable (private mode) — the bar still works
      // this load, it just isn't remembered across reloads.
    }
    setProgress(100)
    // Let the fill animation play, then fade out and stand down.
    setTimeout(() => setVisible(false), 250)
    setTimeout(() => setArmed(false), 600)
  }, [])

  // Milestones are recorded unconditionally (ordering-independent: a consumer's
  // effect may run before this provider arms). Progress + completion are then
  // derived here once armed.
  const report = useCallback((step: ProgressStep) => {
    if (finished.current) return
    if (reported.current.has(step)) return
    reported.current.add(step)
    setTick(t => t + 1)
  }, [])

  useEffect(() => {
    if (!armed || finished.current) return
    const done = expected.filter(s => reported.current.has(s)).length
    const fraction = done / expected.length
    setProgress(Math.max(BASELINE, Math.round(BASELINE + fraction * (100 - BASELINE))))
    if (done >= expected.length) finish()
  }, [tick, armed, expected, finish])

  // Safety net: force-complete if a milestone never arrives.
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(finish, MAX_WAIT_MS)
    return () => clearTimeout(t)
  }, [armed, finish])

  // Lightweight nav feedback after the first load: a quick trickle on each
  // pathname change so route transitions feel responsive.
  const [trickle, setTrickle] = useState<number | null>(null)
  const firstPath = useRef(pathname)
  useEffect(() => {
    if (armed) return // first load owns the bar
    if (pathname === firstPath.current) return
    firstPath.current = pathname
    setTrickle(15)
    const ramp = setTimeout(() => setTrickle(85), 30)
    const done = setTimeout(() => setTrickle(100), 220)
    const hide = setTimeout(() => setTrickle(null), 450)
    return () => {
      clearTimeout(ramp)
      clearTimeout(done)
      clearTimeout(hide)
    }
  }, [pathname, armed])

  const ctx = useMemo(() => ({ report }), [report])

  const width = armed ? progress : (trickle ?? 0)
  const showBar = armed ? visible : trickle !== null

  return (
    <ProgressContext.Provider value={ctx}>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]"
        style={{ opacity: showBar ? 1 : 0, transition: 'opacity 300ms ease' }}
      >
        <div
          className="h-full bg-[var(--theme-300)] shadow-[0_0_8px_var(--theme-300)]"
          style={{
            width: `${width}%`,
            transition: 'width 300ms ease-out'
          }}
        />
      </div>
      {children}
    </ProgressContext.Provider>
  )
}
