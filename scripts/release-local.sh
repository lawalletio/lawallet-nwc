#!/usr/bin/env bash
#
# Cut a release from this machine, running what .github/workflows/release.yml
# would have run on a GitHub-hosted runner.
#
# This exists for when Actions cannot run the release — no hosted runner
# available, a spending limit, an outage. It is deliberately the same sequence
# in the same order, so a local release is not a different release.
#
#   bash scripts/release-local.sh --bump minor
#   bash scripts/release-local.sh --bump patch --dry-run
#   bash scripts/release-local.sh --bump minor --with-docker
#
# Docker publishing is opt-in (--with-docker) because it is the one step that
# differs from CI in kind, not just in location: the workflow builds each
# architecture on a native runner, while here linux/amd64 is emulated. It is
# slow and has run the Docker VM out of memory before. Without the flag the
# script stops after the GitHub Release, which is exactly the state CI is in
# when its release job succeeds and the docker job has not run yet.
set -euo pipefail

BUMP=""
DRY_RUN=0
WITH_DOCKER=0

while [ $# -gt 0 ]; do
  case "$1" in
    --bump) BUMP="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --with-docker) WITH_DOCKER=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$BUMP" in
  patch|minor|major) ;;
  *) echo "usage: $0 --bump <patch|minor|major> [--dry-run] [--with-docker]" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31merror: %s\033[0m\n' "$1" >&2; exit 1; }

# ── Preflight ───────────────────────────────────────────────────────────────
# Every check here is something that would silently produce a wrong release
# rather than an obvious failure.
step 'Preflight'

[ -z "$(git status --porcelain)" ] || fail 'working tree is dirty — commit or stash first'

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = 'main' ] || fail "must release from main, on '$branch'"

git fetch origin main --tags --quiet
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse origin/main)"
[ "$local_sha" = "$remote_sha" ] ||
  fail 'local main differs from origin/main — pull or push first'

command -v gh >/dev/null || fail 'gh CLI is required to create the release'
gh auth status >/dev/null 2>&1 || fail 'gh is not authenticated (gh auth login)'

if [ "$WITH_DOCKER" = 1 ]; then
  command -v docker >/dev/null || fail 'docker is required for --with-docker'
  # Checked up front: discovering this after the tag is pushed leaves a
  # released version with no images.
  docker buildx inspect --bootstrap >/dev/null 2>&1 ||
    fail 'docker buildx is not available'
  echo 'https://index.docker.io/v1/' | docker-credential-desktop get >/dev/null 2>&1 ||
    docker system info 2>/dev/null | grep -q '^ *Username:' ||
    fail 'not logged in to Docker Hub — run: docker login'
fi
echo "main @ ${local_sha:0:7}, clean, in sync"

# ── Gates ───────────────────────────────────────────────────────────────────
# Identical to release.yml. `build` is included because lint/typecheck/test do
# not exercise the Next.js bundle.
step 'Quality gates (lint, typecheck, test, build)'
pnpm install --frozen-lockfile
DATABASE_URL='postgresql://ci:ci@localhost:5432/ci' \
JWT_SECRET='ci-build-secret-minimum-32-characters-long' \
  pnpm turbo run lint typecheck test build

step 'Docs drift'
pnpm docs:check

step 'Deployment environment contract (strict)'
STRICT_EXTERNAL_PACKAGES=1 pnpm deploy:check

# ── Version bump ────────────────────────────────────────────────────────────
# release.mjs scaffolds docs/changelogs/v<next>.md only when it does not
# already exist, so a hand-written changelog is preserved.
step "Bump version ($BUMP)"
if [ "$DRY_RUN" = 1 ]; then
  next="$(node -p "
    const s=require('semver');
    s.inc(require('$root/package.json').version, '$BUMP')
  " 2>/dev/null || true)"
  echo "would bump $(node -p "require('$root/package.json').version") -> ${next:-<next>}"
  echo 'dry run — stopping before any commit, tag, push or release'
  exit 0
fi

GITHUB_OUTPUT="$(mktemp)"; export GITHUB_OUTPUT
node scripts/release.mjs --bump "$BUMP"
VERSION="$(sed -n 's/^version=//p' "$GITHUB_OUTPUT")"
rm -f "$GITHUB_OUTPUT"
[ -n "$VERSION" ] || fail 'release.mjs did not report a version'
echo "version: $VERSION"

notes="docs/changelogs/v${VERSION}.md"
[ -f "$notes" ] || fail "missing $notes"

# ── Commit, tag, push ───────────────────────────────────────────────────────
step "Commit, tag and push v${VERSION}"
git add package.json apps/web/package.json apps/cli/package.json docs/changelogs/
git commit -m "chore(release): v${VERSION}"
# Annotated, and pushed explicitly: --follow-tags skips lightweight tags, which
# silently dropped the tag in v0.11.0.
git tag -a "v${VERSION}" -m "v${VERSION}"
git push origin main "refs/tags/v${VERSION}"
RELEASE_SHA="$(git rev-parse HEAD)"

step "Create GitHub Release v${VERSION}"
gh release create "v${VERSION}" --title "v${VERSION}" --notes-file "$notes"

# ── Docker ──────────────────────────────────────────────────────────────────
if [ "$WITH_DOCKER" = 0 ]; then
  cat <<EOF

Release v${VERSION} is tagged and published on GitHub.

Docker images were NOT built (no --with-docker). Publish them with either:
  gh workflow run docker-publish.yml --ref main -f tag=${VERSION} -f ref=${RELEASE_SHA}
  bash scripts/release-local.sh --bump ${BUMP} --with-docker   # only before tagging
EOF
  exit 0
fi

step "Build and push images for ${VERSION} (linux/amd64 + linux/arm64)"
# One buildx invocation per image, both platforms at once so the manifest list
# is produced directly — the workflow splits per-arch only because it has a
# native runner for each.
for img in web listener; do
  case "$img" in
    web) repo='masize/lawallet-nwc'; dockerfile='apps/web/Dockerfile' ;;
    listener) repo='masize/lawallet-nwc-listener'; dockerfile='apps/listener/Dockerfile' ;;
  esac
  echo "building ${repo}:${VERSION}"
  # Context is the repo root: both Dockerfiles copy the root lockfile,
  # pnpm-workspace.yaml and packages/shared.
  docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --file "$dockerfile" \
    --tag "${repo}:${VERSION}" \
    --tag "${repo}:latest" \
    --push \
    .
done

step 'Notify downstream app stores'
# Same event_type and payload the workflow sends — the receiving repositories
# key off both, so a hand-rolled shape would be ignored or mis-handled.
dispatch_payload="$(VERSION="$VERSION" RELEASE_SHA="$RELEASE_SHA" python3 - <<'PY'
import json, os
version = os.environ["VERSION"]
print(json.dumps({
    "event_type": "lawallet-nwc-release",
    "client_payload": {
        "version": version,
        "image": f"masize/lawallet-nwc:{version}",
        "listener_image": f"masize/lawallet-nwc-listener:{version}",
        "source_repository": "lawalletio/lawallet-nwc",
        "source_sha": os.environ["RELEASE_SHA"],
        "source_run_url": "local (scripts/release-local.sh)",
    },
}))
PY
)"
for repo_name in umbrel-app-store lawallet-startos; do
  if printf '%s' "$dispatch_payload" |
    gh api --method POST "repos/lawalletio/${repo_name}/dispatches" --input - >/dev/null 2>&1
  then
    echo "dispatched ${repo_name}"
  else
    # CI uses dedicated cross-repo tokens; a personal gh login may not carry
    # write access to those repositories.
    echo "WARNING: dispatch to ${repo_name} failed — your gh token may lack write access there. Trigger it manually."
  fi
done

echo
echo "Release v${VERSION} complete: tag, GitHub Release, images and dispatches."
