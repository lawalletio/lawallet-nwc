#!/usr/bin/env bash
#
# Cloud Agent start phase for lawallet-nwc.
#
# Runs on every boot. Brings the persistent PostgreSQL cluster back up (its data
# dir survives in the environment snapshot) and reconciles pending migrations.
# Idempotent: tolerates an already-running server and re-runs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=scripts/cloud-agent/postgres-lib.sh
source "$SCRIPT_DIR/postgres-lib.sh"

# Regenerate env files (restoring persisted secrets) — a fresh checkout wipes
# the untracked env, and ensure_env keeps secrets consistent with seeded data.
ensure_env

# Export generated vars (DATABASE_URL, NWC_VAULT_SECRET, …) for Prisma commands.
set -a
# shellcheck disable=SC1091
. "$REPO_ROOT/.env.development.local"
set +a

load_db_env
pg_init
pg_start
pg_ensure_db

# Apply any migrations that shipped with the checked-out revision.
pnpm --filter @lawallet-nwc/web exec prisma migrate deploy

echo "[start] PostgreSQL ready on port $PG_PORT"
