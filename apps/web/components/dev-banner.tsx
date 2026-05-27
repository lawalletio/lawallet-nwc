/**
 * Thin global banner shown only outside production, so it's obvious at a
 * glance when you're looking at a local `next dev` instance rather than the
 * live site. Gated by NODE_ENV (set to `production` on real deploys), read
 * directly from `process.env` so this stays a zero-dependency server
 * component that can never throw during layout render.
 *
 * Render conditionally from the root layout:
 *   {process.env.NODE_ENV !== 'production' && <DevBanner />}
 */
export function DevBanner() {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-400 px-3 py-1 text-center text-xs font-semibold text-black"
    >
      <span className="inline-block size-1.5 animate-pulse rounded-full bg-black/70" />
      Local development — not production
    </div>
  )
}
