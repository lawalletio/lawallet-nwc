#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

export LAWALLET_CLI_NPM_SPEC="${LAWALLET_CLI_NPM_SPEC:-${REPO_ROOT}/apps/cli}"
export LAWALLET_REPO_URL="${LAWALLET_REPO_URL:-${LAWALLET_CLI_REPO_URL:-https://github.com/lawalletio/lawallet-nwc.git}}"

exec bash "${REPO_ROOT}/install.sh" "$@"
