#!/usr/bin/env bash

# Claude Code SessionStart hook (also safe to run by hand).
#
# Makes sure this checkout — main clone or git worktree — has a usable
# apps/web env file without ever clobbering one a human already configured.
# Worktrees get their own isolated env (ports, DB name, JWT secret) via
# scripts/dev-worktree.mjs, which is idempotent and preserves existing values.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# An env file already exists (hand-written .env or generated .env.local):
# leave everything alone.
if [[ -e "$root/apps/web/.env" || -e "$root/apps/web/.env.local" ]]; then
  exit 0
fi

# No env at all (fresh clone or fresh worktree): materialize one. `env` only
# writes files — it does not install, start docker, or touch the database.
node "$root/scripts/dev-worktree.mjs" env >/dev/null 2>&1 || true
