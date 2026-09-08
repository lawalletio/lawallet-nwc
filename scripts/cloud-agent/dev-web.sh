#!/usr/bin/env bash
#
# Long-running web dev server for the Cloud Agent environment (terminals entry).
# Postgres is already up via start.sh; this just launches `next dev` on the
# per-worktree WEB_PORT from the generated env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Ensure env files exist (restoring persisted secrets) in case this terminal
# starts on a fresh checkout before/independently of start.sh.
if [ ! -f "$REPO_ROOT/.env.development.local" ]; then
  # shellcheck source=scripts/cloud-agent/postgres-lib.sh
  source "$SCRIPT_DIR/postgres-lib.sh"
  ensure_env
fi

set -a
# shellcheck disable=SC1091
. "$REPO_ROOT/.env.development.local"
set +a

echo "[web] Starting Next.js dev server on http://localhost:${WEB_PORT}/admin"
exec pnpm --filter @lawallet-nwc/web exec next dev --port "${WEB_PORT}"
