#!/usr/bin/env bash

set -euo pipefail

SOURCE_SNAPSHOT="${LAWALLET_SMOKE_SOURCE_SNAPSHOT:-/opt/lawallet-nwc-snapshot}"
SOURCE_REPO="${LAWALLET_SMOKE_SOURCE_REPO:-/workspace/lawallet-nwc}"
INSTALL_ROOT="${LAWALLET_SMOKE_INSTALL_ROOT:-/workspace/install}"
APP_PORT="${LAWALLET_SMOKE_APP_PORT:-2288}"
DOCS_PORT="${LAWALLET_SMOKE_DOCS_PORT:-3000}"
OPENAPI_PORT="${LAWALLET_SMOKE_OPENAPI_PORT:-4500}"
POSTGRES_PORT="${LAWALLET_SMOKE_POSTGRES_PORT:-55432}"
INSTALLED_REPO="${INSTALL_ROOT}/lawallet-nwc"

print_section() {
  printf '\n==> %s\n' "$1"
}

dump_diagnostics() {
  local status=$1

  if [ "${status}" -eq 0 ]; then
    return
  fi

  echo
  echo "Smoke test failed. Collecting diagnostics..." >&2

  if [ -f /var/log/dockerd.log ]; then
    echo >&2
    echo "--- dockerd log (tail) ---" >&2
    tail -n 200 /var/log/dockerd.log >&2 || true
  fi

  if [ -d "${INSTALLED_REPO}" ]; then
    echo >&2
    echo "--- install state ---" >&2
    sed -n '1,200p' "${INSTALLED_REPO}/.lawallet/install-state.json" >&2 || true

    echo >&2
    echo "--- compose ps ---" >&2
    (
      cd "${INSTALLED_REPO}" &&
        docker compose ps
    ) >&2 || true

    echo >&2
    echo "--- compose logs (tail) ---" >&2
    (
      cd "${INSTALLED_REPO}" &&
        docker compose logs --no-color --tail=200
    ) >&2 || true

    echo >&2
    echo "--- web service status ---" >&2
    (
      cd "${INSTALLED_REPO}/apps/web" &&
        pnpm service status
    ) >&2 || true
  fi
}

trap 'dump_diagnostics "$?"' EXIT

prepare_source_repo() {
  rm -rf "${SOURCE_REPO}"
  mkdir -p "$(dirname "${SOURCE_REPO}")"
  cp -a "${SOURCE_SNAPSHOT}/." "${SOURCE_REPO}"
  rm -rf \
    "${SOURCE_REPO}/.git" \
    "${SOURCE_REPO}/.lawallet" \
    "${SOURCE_REPO}/.pnpm-store"
  find "${SOURCE_REPO}" -type d \( -name node_modules -o -name .next -o -name .turbo \) -prune -exec rm -rf {} +

  git -C "${SOURCE_REPO}" init --initial-branch=main >/dev/null
  git -C "${SOURCE_REPO}" add --all
  git -C "${SOURCE_REPO}" \
    -c user.name="LaWallet Smoke" \
    -c user.email="smoke@lawallet.local" \
    commit -m "Smoke test snapshot" >/dev/null
}

assert_service_running() {
  local running_services

  running_services="$(
    cd "${INSTALLED_REPO}" &&
      docker compose ps --services --filter status=running
  )"

  printf '%s\n' "${running_services}" | grep -qx 'postgres'
  printf '%s\n' "${running_services}" | grep -qx 'web'
  printf '%s\n' "${running_services}" | grep -qx 'docs'
  printf '%s\n' "${running_services}" | grep -qx 'openapi'
}

assert_http_ready() {
  local web_health_path docs_health_path openapi_path openapi_health_path
  web_health_path="/tmp/lawallet-web-health.json"
  docs_health_path="/tmp/lawallet-docs-health.json"
  openapi_path="/tmp/lawallet-openapi.json"
  openapi_health_path="/tmp/lawallet-openapi-health.json"

  curl --fail --silent --show-error \
    "http://127.0.0.1:${APP_PORT}/api/health" \
    >"${web_health_path}"

  grep -q '"database":"up"' "${web_health_path}"

  curl --fail --silent --show-error \
    "http://127.0.0.1:${DOCS_PORT}/api/health" \
    >"${docs_health_path}"

  grep -q '"service":"docs"' "${docs_health_path}"

  curl --fail --silent --show-error \
    "http://127.0.0.1:${OPENAPI_PORT}/health" \
    >"${openapi_health_path}"

  grep -q '"service":"openapi"' "${openapi_health_path}"

  curl --fail --silent --show-error \
    "http://127.0.0.1:${OPENAPI_PORT}/openapi.json" \
    >"${openapi_path}"

  grep -q '"openapi"' "${openapi_path}"
}

print_section "Preparing a local git snapshot"
prepare_source_repo

export LAWALLET_CLI_REPO_URL="${SOURCE_REPO}"

print_section "Running the bootstrap installer"
bash "${SOURCE_REPO}/scripts/install-lawallet-cli.sh" \
  --mode docker \
  --yes \
  --dir "${INSTALL_ROOT}" \
  --app-port "${APP_PORT}" \
  --docs-port "${DOCS_PORT}" \
  --openapi-port "${OPENAPI_PORT}" \
  --postgres-port "${POSTGRES_PORT}"

if [ ! -f "${INSTALLED_REPO}/.lawallet/install-state.json" ]; then
  echo "Expected install metadata at ${INSTALLED_REPO}/.lawallet/install-state.json." >&2
  exit 1
fi

print_section "Verifying containers"
assert_service_running
(
  cd "${INSTALLED_REPO}" &&
    docker compose ps
)

print_section "Verifying the running app"
assert_http_ready
curl --fail --silent --show-error \
  "http://127.0.0.1:${APP_PORT}/api/health" |
  sed -n '1,20p'
curl --fail --silent --show-error \
  "http://127.0.0.1:${DOCS_PORT}/api/health" |
  sed -n '1,20p'
curl --fail --silent --show-error \
  "http://127.0.0.1:${OPENAPI_PORT}/openapi.json" |
  sed -n '1,20p'

print_section "Checking service status via pnpm"
(
  cd "${INSTALLED_REPO}/apps/web" &&
    pnpm service status
)

print_section "Smoke test passed"
printf 'LaWallet web is reachable at http://127.0.0.1:%s\n' "${APP_PORT}"
printf 'LaWallet docs is reachable at http://127.0.0.1:%s\n' "${DOCS_PORT}"
printf 'LaWallet OpenAPI is reachable at http://127.0.0.1:%s\n' "${OPENAPI_PORT}"
