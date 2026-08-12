import { NotFoundError } from '@/types/server/errors'

/**
 * Single gate for every `/api/dev/*` route. Both conditions are required:
 * not production AND the explicit `ENABLE_DEV_ROUTES=true` opt-in.
 *
 * The opt-in exists because `next dev` instances are routinely exposed
 * through tunnels (see `allowedDevOrigins`) and non-production deploys run
 * with NODE_ENV values these routes used to treat as safe — `/api/dev/reset`
 * wipes the entire database with no auth, so "not production" alone was not
 * a sufficient boundary. The worktree bootstrap (`scripts/dev-worktree.mjs`)
 * sets the flag in the generated local env; everywhere else the routes 404.
 */
export function assertDevRoutesEnabled(): void {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.ENABLE_DEV_ROUTES !== 'true'
  ) {
    throw new NotFoundError('Not found')
  }
}
