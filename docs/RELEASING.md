# Releasing

Releases are cut by the **Release** workflow
(`.github/workflows/release.yml`) — one dispatch, no local steps:

```bash
pnpm release minor    # or: pnpm release patch / pnpm release major
# equivalent: gh workflow run release.yml -f bump=minor
# or: GitHub → Actions → Release → Run workflow
```

Needs a `gh` login whose token carries the `workflow` scope; without it the
dispatch is rejected and nothing is released.

The workflow, in order:

1. **Gates** — `lint` + `typecheck` + `test` + `build` + `docs:check` on `main`,
   then `deploy:check` with `STRICT_EXTERNAL_PACKAGES=1`. A release never ships
   red.

   The strict pass is the one that blocks on **external** packages. It fetches
   the live Umbrel and StartOS manifests and fails if they haven't adopted a
   runtime secret the app now requires, so a tag-only bump can't ship an
   install that crash-loops (v2.1.0 did exactly that on Umbrel).

   It blocks only on packages **we can merge into** —
   `lawalletio/umbrel-app-store` and `lawalletio/lawallet-startos`. For those,
   "not adopted yet" means we forgot. `Start9-Community/lawallet-startos` is a
   third-party registry whose PRs the Start9 Community merges, so it warns and
   never blocks: gating our releases on someone else's review queue would mean
   we could not ship at all. Check it before dispatching:

   ```bash
   STRICT_EXTERNAL_PACKAGES=1 pnpm deploy:check
   ```

2. **Version bump** (`scripts/release.mjs`) — lockstep across the platform
   packages: root, `@lawallet-nwc/web`, `@lawallet-nwc/cli`,
   `@lawallet-nwc/listener`. The base is the higher of the root `package.json`
   version and the latest `v*` tag, so the two can never drift apart again.
   (`packages/shared|openapi|sdk` are versioned independently and untouched.)
3. **Changelog** — `docs/changelogs/v<version>.md`. If the file already exists
   the workflow leaves it alone; otherwise it scaffolds the house format
   pre-filled with every merged PR since the last tag.
4. **Commit + tag** — `chore(release): vX.Y.Z` pushed to `main` with the
   `vX.Y.Z` tag by the github-actions bot.
5. **GitHub Release** — created with `docs/changelogs/v<version>.md` as the
   release body, verbatim.

## Write the changelog before you dispatch

The changelog is not just documentation — it is the source of the release notes
users read on their node:

```
docs/changelogs/vX.Y.Z.md
  └─ GitHub Release body            (release.yml, --notes-file)
       └─ Umbrel "update available" note   (umbrel-app-store reads the
                                            release body at dispatch time and
                                            writes it into umbrel-app.yml)
```

So a scaffold left unedited ships to every Umbrel node as a raw list of commit
subjects. That is what happened to v2.6.0 — its `## Summary` is still an empty
HTML comment, and the live Umbrel manifest shows five bare PR lines.

**Write the narrative Summary + themed Highlights and merge them to `main`
before dispatching the release.** Generate the raw material with:

```bash
pnpm release minor --dry   # next version + PR list; dispatches nothing, writes nothing
```

Then create `docs/changelogs/v<next>.md` from it in a normal PR. Because the
workflow only scaffolds when the file is absent, your version is what ships.

The `--dry` numbers come from your checkout while the workflow recomputes them
from `main`, so preview from an up-to-date `main` if you want them to match.

## Versioning policy

Pre-1.0 semantics: **minor** for feature releases (the normal case),
**patch** for fix-only follow-ups, **major** reserved for 1.0.

## After the release

Confirm the downstream packages picked it up — `docker-publish.yml` dispatches
both after the images are pushed, and each opens (and self-merges) its own
package bump:

| Target | Repo | Expect |
| --- | --- | --- |
| Umbrel | `lawalletio/umbrel-app-store` | `version:` + both image tags bumped, `releaseNotes` matching the changelog |
| Start9 (sideload) | `lawalletio/lawallet-startos` | `<version>:0` in `startos/versions/current.ts`, a signed `.s9pk` on the release |

`Start9-Community/lawallet-startos` is **not** dispatched — that listing is
updated by PR into a third-party registry. Its package version starts at `:1`
because the sideload repo publishes `:0` for the same package id.

If the changelog needed a fix after tagging, edit it and update the GitHub
Release body too (`gh release edit vX.Y.Z --notes-file …`) — the Umbrel note is
already written by then and only refreshes on the next release.
