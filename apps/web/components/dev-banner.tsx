/**
 * Thin global banner shown only outside production, so it's obvious at a
 * glance when you're looking at a local `next dev` instance rather than the
 * live site. Gated by NODE_ENV (set to `production` on real deploys), read
 * directly from `process.env` so this stays a zero-dependency server
 * component that can never throw during layout render.
 *
 * Render conditionally from the root layout:
 *   {process.env.NODE_ENV !== 'production' && <DevBanner />}
 *
 * It also carries the "Login as admin" shortcut, but that's allowlisted
 * tighter than the banner: it only shows when `NODE_ENV === 'development'`
 * (the banner shows for any non-production env), and its API 404s otherwise —
 * so the shortcut is double-gated.
 */
import { DevAdminLogin } from '@/components/dev-admin-login'
import { DevImpersonationControl } from '@/components/dev-impersonation-control'

export function DevBanner() {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-400 px-3 py-1 text-center text-xs font-semibold text-black"
    >
      <span className="inline-flex items-center gap-2">
        <span className="inline-block size-1.5 animate-pulse rounded-full bg-black/70" />
        Local development — not production
      </span>
      {process.env.NODE_ENV === 'development' && (
        <>
          <DevImpersonationControl />
          <DevAdminLogin />
        </>
      )}
    </div>
  )
}
