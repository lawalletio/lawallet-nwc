#!/usr/bin/env bash
# Starts the worktree-local web app and NWC listener when a Codex session
# begins. Existing servers are preserved, so opening another session is safe.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
env_file="$root/.env.development.local"
log_dir="$root/.dev"

port_from_env() {
  local key="$1"
  [ -f "$env_file" ] || return 0
  sed -n "s/^${key}=\"\{0,1\}\([0-9][0-9]*\)\"\{0,1\}$/\1/p" "$env_file" | head -1
}

listening() {
  local port="$1"
  [ -n "$port" ] && lsof -i ":$port" -sTCP:LISTEN -n -P >/dev/null 2>&1
}

start_web() {
  mkdir -p "$log_dir"
  nohup bash --noprofile --norc -c 'cd "$1" && exec pnpm start:dev-server' _ "$root" \
    >"$log_dir/codex-web.log" 2>&1 < /dev/null &
}

start_listener() {
  mkdir -p "$log_dir"
  nohup bash --noprofile --norc -c '
    set -euo pipefail
    root="$1"
    for _ in $(seq 1 60); do
      [ -f "$root/.env.development.local" ] && break
      sleep 1
    done
    cd "$root"
    nvm_sh="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    if [ -s "$nvm_sh" ]; then
      # shellcheck disable=SC1090
      . "$nvm_sh"
      nvm use --silent
    fi
    exec pnpm dev:listener
  ' _ "$root" >"$log_dir/codex-listener.log" 2>&1 < /dev/null &
}

web_port="$(port_from_env WEB_PORT)"
listener_port="$(port_from_env LISTENER_PORT)"

if listening "$web_port"; then
  web_state="already running"
else
  start_web
  web_state="starting"
fi

if listening "$listener_port"; then
  listener_state="already running"
else
  start_listener
  listener_state="starting"
fi

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Local dev: web %s; listener %s. Logs: .dev/codex-web.log and .dev/codex-listener.log."}}\n' \
  "$web_state" "$listener_state"
