#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
CLI_PACKAGE_DIR="${REPO_ROOT}/apps/cli"
CLI_REPO_SOURCE="${LAWALLET_CLI_REPO_URL:-https://github.com/lawalletio/lawallet-nwc.git}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20.13.0 or newer is required." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install the LaWallet CLI." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
NODE_MINOR="$(node -p "process.versions.node.split('.')[1]")"

if [ "${NODE_MAJOR}" -lt 20 ] || { [ "${NODE_MAJOR}" -eq 20 ] && [ "${NODE_MINOR}" -lt 13 ]; }; then
  echo "Node.js 20.13.0 or newer is required." >&2
  exit 1
fi

if [ "${NODE_MAJOR}" -lt 22 ] || { [ "${NODE_MAJOR}" -eq 22 ] && [ "${NODE_MINOR}" -lt 14 ]; }; then
  echo "Note: the LaWallet repo itself is pinned to Node.js 22.14.0 in .nvmrc." >&2
fi

echo "Installing the local LaWallet CLI package globally..."
npm install --global "${CLI_PACKAGE_DIR}"

echo
echo "Running lawallet install using repo source: ${CLI_REPO_SOURCE}"
LAWALLET_REPO_URL="${CLI_REPO_SOURCE}" lawallet install "$@"
