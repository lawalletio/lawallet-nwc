import * as React from 'react'

const MOBILE_BREAKPOINT = 768

export function useIsMobile(maxWidthPx = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxWidthPx - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < maxWidthPx)
    }
    mql.addEventListener('change', onChange)
    setIsMobile(window.innerWidth < maxWidthPx)
    return () => mql.removeEventListener('change', onChange)
  }, [maxWidthPx])

  return !!isMobile
}

/**
 * Generic "is the viewport narrower than `maxWidthPx`?" hook.
 *
 * Unlike {@link useIsMobile} this returns `boolean | undefined` — the
 * `undefined` is the pre-measurement state on first client render.
 * Callers that pick between two heavyweight branches (e.g. the
 * Connection Map's xyflow canvas vs. its mobile tab list) can hold a
 * neutral placeholder until the breakpoint resolves instead of
 * flashing the wrong branch for one frame and mounting it needlessly.
 */
export function useIsBelowWidth(maxWidthPx: number): boolean | undefined {
  const [below, setBelow] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxWidthPx - 1}px)`)
    const onChange = () => setBelow(window.innerWidth < maxWidthPx)
    mql.addEventListener('change', onChange)
    setBelow(window.innerWidth < maxWidthPx)
    return () => mql.removeEventListener('change', onChange)
  }, [maxWidthPx])

  return below
}
