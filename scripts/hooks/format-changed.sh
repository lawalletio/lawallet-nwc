#!/usr/bin/env bash

# Claude Code PostToolUse hook (Edit|Write): format the just-changed file with
# the repo's Prettier config so agent edits always match house style
# (no semicolons, single quotes, no trailing commas).
#
# Receives the hook payload as JSON on stdin; only acts on JS/TS sources.
# Always exits 0 — formatting must never block an edit.

set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

file="$(node -e '
  let d = ""
  process.stdin.on("data", c => (d += c)).on("end", () => {
    try {
      const j = JSON.parse(d)
      process.stdout.write(j.tool_input?.file_path || "")
    } catch {}
  })
')"

case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs)
    if [[ -f "$file" ]]; then
      (cd "$root" && pnpm exec prettier --write "$file" --log-level silent) || true
    fi
    ;;
esac

exit 0
