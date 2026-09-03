#!/usr/bin/env bash
#
# Cloud Agent install phase for lawallet-nwc.
#
# Idempotent, one-time repository bootstrap:
#   1. install a native PostgreSQL server (Cloud VMs have no Docker)
#   2. install workspace dependencies + generate the Prisma client
#   3. generate per-worktree dev env files (secrets, ports, DATABASE_URL)
#   4. start Postgres and apply migrations, seeding a fresh database once
#
# The long-lived web dev server is NOT started here (see start.sh / terminals).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# 1. PostgreSQL server ---------------------------------------------------------
if ! ls /usr/lib/postgresql/*/bin/initdb >/dev/null 2>&1 && ! command -v initdb >/dev/null 2>&1; then
  echo "[install] Installing PostgreSQL"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-client
fi

# 2. Dependencies + Prisma client ---------------------------------------------
echo "[install] Installing workspace dependencies"
pnpm install --frozen-lockfile

echo "[install] Generating Prisma client"
pnpm --filter @lawallet-nwc/web exec prisma generate

# 3. Dev env files -------------------------------------------------------------
# shellcheck source=scripts/cloud-agent/postgres-lib.sh
source "$SCRIPT_DIR/postgres-lib.sh"

# Writes .env.development.local + apps/*/.env.local with secrets, ports and a
# DATABASE_URL pointing at localhost:<POSTGRES_PORT>. ensure_env keeps the
# generated secrets stable across rebuilds (see postgres-lib.sh).
echo "[install] Generating dev environment files"
ensure_env

# Export the generated vars so Prisma migrate/seed (ts-node doesn't auto-load
# .env.local) and any child commands see DATABASE_URL, NWC_VAULT_SECRET, etc.
set -a
# shellcheck disable=SC1091
. "$REPO_ROOT/.env.development.local"
set +a

# 4. Database ------------------------------------------------------------------
load_db_env
pg_init
pg_start
pg_ensure_db

echo "[install] Applying migrations"
pnpm --filter @lawallet-nwc/web exec prisma migrate deploy

# Seed only when the database has no users yet, so re-runs never clobber data.
BINDIR="$(pg_bindir)"
USER_COUNT="$("$BINDIR/psql" -h 127.0.0.1 -p "$PG_PORT" -U "$(id -un)" -d "$PG_DATABASE" -tAc \
  'SELECT count(*) FROM "User"' 2>/dev/null || echo 0)"
if [ "${USER_COUNT:-0}" = "0" ]; then
  echo "[install] Seeding database"
  pnpm --filter @lawallet-nwc/web run seed
else
  echo "[install] Database already seeded ($USER_COUNT users); skipping seed"
fi

echo "[install] Done. Web dev server URL: http://localhost:$(grep -E '^WEB_PORT=' "$REPO_ROOT/.env.development.local" | head -1 | cut -d= -f2- | tr -d '\"')/admin"
