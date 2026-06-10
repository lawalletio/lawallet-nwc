# Releasing

Releases are cut by the **Release** workflow
(`.github/workflows/release.yml`) — one dispatch, no local steps:

```bash
pnpm release:patch    # or release:minor / release:major
# equivalent: gh workflow run release.yml -f bump=minor
# or: GitHub → Actions → Release → Run workflow
```

The workflow, in order:

1. **Gates** — `lint` + `typecheck` + `test` + `docs:check` on `main`.
   A release never ships red.
2. **Version bump** (`scripts/release.mjs`) — lockstep across the platform
   packages: root, `@lawallet-nwc/web`, `@lawallet-nwc/cli`. The base is the
   higher of the root `package.json` version and the latest `v*` tag, so the
   two can never drift apart again. (`packages/shared|openapi|sdk` are
   versioned independently and untouched.)
3. **Changelog scaffold** — `docs/changelogs/v<version>.md` in the house
   format, pre-filled with every merged PR since the last tag. Edit it after
   the release to add the narrative Summary/Highlights (see `v0.10.0.md`).
4. **Commit + tag** — `chore(release): vX.Y.Z` pushed to `main` with the
   `vX.Y.Z` tag by the github-actions bot.
5. **GitHub Release** — created with auto-generated PR notes plus a link to
   the narrative changelog.

## Versioning policy

Pre-1.0 semantics: **minor** for feature releases (the normal case),
**patch** for fix-only follow-ups, **major** reserved for 1.0.

## Local preview

```bash
pnpm release:dry      # shows the next version + the PR list, writes nothing
```

## After the release

Polish `docs/changelogs/v<version>.md` (Summary + themed Highlights) in a
regular PR — the scaffold's raw PR list is the source material.
