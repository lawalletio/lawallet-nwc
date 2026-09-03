# shellcheck shell=bash
# Shared helpers for running a native PostgreSQL instance for Cloud Agent dev.
#
# The repo's normal dev loop (`pnpm start:dev-server`) provisions Postgres via
# `docker compose`. Cloud Agent VMs don't ship Docker, so here we run a
# self-contained PostgreSQL cluster from a home-directory data dir instead.
# The data dir lives outside the repo and survives environment snapshots, so a
# build that seeds the database once keeps that data on later boots.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_DATA="${LAWALLET_PGDATA:-$HOME/.lawallet/pgdata}"
PG_LOG="${LAWALLET_PGLOG:-$HOME/.lawallet/postgres.log}"
PG_SOCKET_DIR="/tmp"

pg_bindir() {
  local dir
  dir="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  if [ -z "$dir" ]; then
    # Fall back to PATH if the Debian layout isn't present.
    dir="$(dirname "$(command -v initdb pg_ctl 2>/dev/null | head -1)")"
  fi
  echo "$dir"
}

# Populate PG_PORT / PG_USER / PG_PASSWORD / PG_DATABASE from the env file that
# `pnpm dev:env` writes. Falls back to the generated JSON state if present.
load_db_env() {
  local state="$REPO_ROOT/.dev/worktree-env.json"
  local envfile="$REPO_ROOT/.env.development.local"

  if [ -f "$state" ]; then
    PG_PORT="$(node -e "process.stdout.write(String(require('$state').POSTGRES_PORT||''))")"
    PG_USER="$(node -e "process.stdout.write(String(require('$state').POSTGRES_USER||''))")"
    PG_PASSWORD="$(node -e "process.stdout.write(String(require('$state').POSTGRES_PASSWORD||''))")"
    PG_DATABASE="$(node -e "process.stdout.write(String(require('$state').POSTGRES_DB||''))")"
  elif [ -f "$envfile" ]; then
    # shellcheck disable=SC1090
    PG_PORT="$(grep -E '^POSTGRES_PORT=' "$envfile" | head -1 | cut -d= -f2- | tr -d '"')"
    PG_USER="$(grep -E '^POSTGRES_USER=' "$envfile" | head -1 | cut -d= -f2- | tr -d '"')"
    PG_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' "$envfile" | head -1 | cut -d= -f2- | tr -d '"')"
    PG_DATABASE="$(grep -E '^POSTGRES_DB=' "$envfile" | head -1 | cut -d= -f2- | tr -d '"')"
  else
    echo "[pg] No env file found; run 'pnpm dev:env' first." >&2
    return 1
  fi

  : "${PG_PORT:?POSTGRES_PORT missing}"
  : "${PG_USER:?POSTGRES_USER missing}"
  : "${PG_DATABASE:?POSTGRES_DB missing}"
  export PG_PORT PG_USER PG_PASSWORD PG_DATABASE
}

pg_init() {
  local bindir
  bindir="$(pg_bindir)"
  mkdir -p "$(dirname "$PG_LOG")"

  if [ -f "$PG_DATA/PG_VERSION" ]; then
    return 0
  fi

  echo "[pg] Initializing cluster at $PG_DATA"
  mkdir -p "$PG_DATA"
  "$bindir/initdb" -D "$PG_DATA" --auth-local=trust --auth-host=trust >/dev/null

  # Dev-only permissive auth: trust local + loopback so password drift between
  # rebuilds never blocks the app. This cluster only listens on localhost.
  cat >"$PG_DATA/pg_hba.conf" <<'EOF'
local   all   all                 trust
host    all   all   127.0.0.1/32  trust
host    all   all   ::1/128       trust
EOF

  {
    echo "listen_addresses = 'localhost'"
    echo "unix_socket_directories = '$PG_SOCKET_DIR'"
  } >>"$PG_DATA/postgresql.conf"
}

pg_running() {
  local bindir
  bindir="$(pg_bindir)"
  "$bindir/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1
}

pg_start() {
  local bindir
  bindir="$(pg_bindir)"

  if pg_running; then
    echo "[pg] Already running"
  else
    echo "[pg] Starting PostgreSQL on port $PG_PORT"
    "$bindir/pg_ctl" -D "$PG_DATA" -l "$PG_LOG" \
      -o "-p $PG_PORT -k $PG_SOCKET_DIR" -w start
  fi

  # Wait until it answers on the configured port.
  local i
  for i in $(seq 1 30); do
    if "$bindir/pg_isready" -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "[pg] Postgres did not become ready" >&2
  tail -20 "$PG_LOG" 2>/dev/null >&2 || true
  return 1
}

pg_ensure_db() {
  local bindir
  bindir="$(pg_bindir)"
  # (re)create the app role if missing
  local role_exists
  role_exists="$("$bindir/psql" -h 127.0.0.1 -p "$PG_PORT" -U "$(id -un)" -d postgres -tAc \
    "SELECT 1 FROM pg_roles WHERE rolname='$PG_USER'" 2>/dev/null || true)"
  if [ "$role_exists" != "1" ]; then
    echo "[pg] Creating role $PG_USER"
    "$bindir/psql" -h 127.0.0.1 -p "$PG_PORT" -U "$(id -un)" -d postgres \
      -c "CREATE ROLE \"$PG_USER\" LOGIN SUPERUSER PASSWORD '$PG_PASSWORD';" >/dev/null
  fi

  local db_exists
  db_exists="$("$bindir/psql" -h 127.0.0.1 -p "$PG_PORT" -U "$(id -un)" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='$PG_DATABASE'" 2>/dev/null || true)"
  if [ "$db_exists" != "1" ]; then
    echo "[pg] Creating database $PG_DATABASE"
    "$bindir/psql" -h 127.0.0.1 -p "$PG_PORT" -U "$(id -un)" -d postgres \
      -c "CREATE DATABASE \"$PG_DATABASE\" OWNER \"$PG_USER\";" >/dev/null
  fi
}
