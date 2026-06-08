#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
compose_file="$repo_root/docker-compose.yml"

slugify() {
  local raw
  raw="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '_')"
  raw="${raw#_}"
  raw="${raw%_}"
  printf '%s' "$raw"
}

hash_text() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum | awk '{ print substr($1, 1, 8) }'
    return
  fi

  printf '%s' "$1" | cksum | awk '{ print $1 }'
}

branch_name="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo detached)"
branch_slug="$(slugify "$branch_name")"

if [[ -z "$branch_slug" ]]; then
  branch_slug="worktree"
fi

worktree_hash="$(hash_text "$repo_root")"
db_name="$(printf 'lawallet_%s_%s' "$branch_slug" "$worktree_hash" | cut -c1-63)"

db_host="${WORKTREE_DB_HOST:-localhost}"
db_port="${WORKTREE_DB_PORT:-5432}"
db_user="${WORKTREE_DB_USER:-lawallet}"
db_password="${WORKTREE_DB_PASSWORD:-lawallet_password}"
db_admin_db="${WORKTREE_DB_ADMIN_DB:-postgres}"
db_url_prefix="${WORKTREE_DATABASE_URL_PREFIX:-postgresql://${db_user}:${db_password}@${db_host}:${db_port}}"
database_url="${db_url_prefix}/${db_name}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  start   Start the bundled Postgres container, create this worktree's DB, print DATABASE_URL
  ensure  Create this worktree's DB if needed, print DATABASE_URL
  reset   Drop and recreate this worktree's DB, print DATABASE_URL
  drop    Drop this worktree's DB
  url     Print this worktree's DATABASE_URL
  env     Print shell exports for this worktree
  name    Print this worktree's database name

Env overrides:
  WORKTREE_DB_HOST, WORKTREE_DB_PORT, WORKTREE_DB_USER, WORKTREE_DB_PASSWORD
  WORKTREE_DB_ADMIN_DB, WORKTREE_DATABASE_URL_PREFIX
EOF
}

compose() {
  docker compose -f "$compose_file" "$@"
}

have_compose_postgres() {
  command -v docker >/dev/null 2>&1 &&
    [[ -f "$compose_file" ]] &&
    compose ps --services --status running 2>/dev/null | grep -qx 'postgres'
}

run_sql() {
  local sql="$1"

  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD="$db_password" psql \
      "host=$db_host port=$db_port user=$db_user dbname=$db_admin_db sslmode=disable" \
      -tAc "$sql"
    return
  fi

  if have_compose_postgres; then
    compose exec -T \
      -e PGPASSWORD="$db_password" \
      postgres \
      psql -U "$db_user" -d "$db_admin_db" -tAc "$sql"
    return
  fi

  cat >&2 <<EOF
Unable to connect to Postgres.

Either:
  1. Install \`psql\` and make sure local Postgres is reachable at $db_host:$db_port
  2. Start the bundled container with: docker compose up -d postgres
EOF
  exit 1
}

wait_for_postgres() {
  local attempt=0

  while (( attempt < 30 )); do
    if run_sql 'SELECT 1' >/dev/null 2>&1; then
      return
    fi

    attempt=$((attempt + 1))
    sleep 1
  done

  echo 'Postgres did not become ready in time.' >&2
  exit 1
}

ensure_database() {
  local exists

  exists="$(run_sql "SELECT 1 FROM pg_database WHERE datname = '$db_name'" | tr -d '[:space:]')"

  if [[ "$exists" != '1' ]]; then
    run_sql "CREATE DATABASE \"$db_name\"" >/dev/null
  fi
}

drop_database() {
  run_sql "DROP DATABASE IF EXISTS \"$db_name\" WITH (FORCE)" >/dev/null
}

start_postgres() {
  if ! command -v docker >/dev/null 2>&1; then
    echo 'Docker is required for the start command.' >&2
    exit 1
  fi

  if [[ ! -f "$compose_file" ]]; then
    echo "Could not find $compose_file" >&2
    exit 1
  fi

  compose up -d postgres >/dev/null
  wait_for_postgres
}

command_name="${1:-help}"

case "$command_name" in
  start)
    start_postgres
    ensure_database
    printf '%s\n' "$database_url"
    ;;
  ensure)
    ensure_database
    printf '%s\n' "$database_url"
    ;;
  reset)
    ensure_database
    drop_database
    ensure_database
    printf '%s\n' "$database_url"
    ;;
  drop)
    drop_database
    ;;
  url)
    printf '%s\n' "$database_url"
    ;;
  env)
    ensure_database
    printf 'export WORKTREE_DB_NAME=%q\n' "$db_name"
    printf 'export DATABASE_URL=%q\n' "$database_url"
    ;;
  name)
    printf '%s\n' "$db_name"
    ;;
  help | --help | -h)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
