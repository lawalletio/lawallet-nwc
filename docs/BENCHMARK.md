# Benchmarks

Micro-benchmarks for CPU-bound hot paths, built on Vitest's `bench` mode —
no extra runtime dependencies.

## Running

```bash
pnpm bench                                # from the repo root (turbo), or:
pnpm --filter @lawallet-nwc/web bench
```

Results print to the console and a JSON report is written to
`apps/web/bench-results/latest.json` (gitignored).

## What is benchmarked

`apps/web/bench/auth.bench.ts`:

| Path | Why it matters |
|------|----------------|
| `createJwtToken` / `verifyJwtToken` (`lib/jwt.ts`) | Runs on every authenticated request |
| `getRolePermissions` (`lib/auth/permissions.ts`) | RBAC resolution on every request |
| `generateNtag424Values` (`lib/ntag424.ts`) | Card key derivation during pairing |

Config: `apps/web/vitest.bench.config.ts` (separate from the test config so
benches never pollute coverage runs). Add new benches as
`apps/web/bench/<area>.bench.ts` — pure, CPU-bound functions only; no DB or
network (those belong in E2E or a load-testing tier).

## Interpreting results

Numbers are **machine-dependent**. Treat them as trends on the same machine,
not absolute SLAs:

- Locally: run before/after a change to the benched path.
- CI: `.github/workflows/e2e.yml` runs the bench job as **observational**
  (`continue-on-error`) and uploads `latest.json` as an artifact. Nothing
  gates on bench numbers — gating requires a dedicated stable runner first.

Reference points from an M-series laptop: JWT sign/verify ≈ 4.5–5k ops/s,
`getRolePermissions` ≈ 20M ops/s, NTAG424 derivation ≈ 165k ops/s.

## Future tiers (when needed)

- HTTP latency SLA (e.g. LUD-16 p95 < 200ms): add `autocannon` against a
  seeded dev server — single lightweight dep.
- Browser perf (CWV/Lighthouse): only worth wiring once public pages
  stabilize.
