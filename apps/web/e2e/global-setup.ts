import { E2E_BASE_URL } from './env'

/**
 * Warm the API routes the suite touches before any worker starts.
 *
 * `webServer.url` only waits for `/api/health`, so Playwright launches every
 * worker the moment that single route has compiled. Under `next dev` each
 * other route is still uncompiled, and they all get requested at once — on a
 * cold, CPU-starved CI runner a request can land while the router is still
 * building and come back as an HTML 404 rather than the route's own response.
 * That is what made `connect-card.spec.ts` fail on
 * `POST /api/cards/:id/activation-tokens` while passing on a re-run of the
 * identical commit.
 *
 * Compiling is per-route, not per-method, so a plain GET is enough to force
 * the module in — including for endpoints the specs only ever POST to. The
 * status is irrelevant here (401 and 404 both mean "it compiled"); only the
 * compile matters, so nothing is asserted.
 */
const WARM_PATHS = [
  '/api/cards',
  '/api/cards/warmup/activation-tokens',
  '/api/activation-tokens/warmup',
  '/api/users',
  '/api/lightning-addresses'
]

export default async function globalSetup(): Promise<void> {
  await Promise.all(
    WARM_PATHS.map(path =>
      fetch(`${E2E_BASE_URL}${path}`).catch(() => {
        // A refused or erroring warmup is not a failure: the point is to make
        // Turbopack build the module, and a thrown request has already done
        // that. Never fail the run here — this is an optimisation, not a gate.
      })
    )
  )
}
