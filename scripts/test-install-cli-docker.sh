#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
IMAGE_TAG="${LAWALLET_SMOKE_IMAGE_TAG:-lawallet-cli-smoke:local}"
APP_PORT="${LAWALLET_SMOKE_APP_PORT:-2288}"
DOCS_PORT="${LAWALLET_SMOKE_DOCS_PORT:-3000}"
OPENAPI_PORT="${LAWALLET_SMOKE_OPENAPI_PORT:-4500}"
POSTGRES_PORT="${LAWALLET_SMOKE_POSTGRES_PORT:-55432}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run the LaWallet installer smoke test." >&2
  exit 1
fi

echo "Building ${IMAGE_TAG} from ${REPO_ROOT}..."
docker build \
  --tag "${IMAGE_TAG}" \
  --file "${REPO_ROOT}/apps/cli/docker-smoke/Dockerfile" \
  "${REPO_ROOT}"

echo
echo "Running the LaWallet installer smoke test in Docker..."
docker run \
  --rm \
  --privileged \
  -e LAWALLET_SMOKE_APP_PORT="${APP_PORT}" \
  -e LAWALLET_SMOKE_DOCS_PORT="${DOCS_PORT}" \
  -e LAWALLET_SMOKE_OPENAPI_PORT="${OPENAPI_PORT}" \
  -e LAWALLET_SMOKE_POSTGRES_PORT="${POSTGRES_PORT}" \
  "${IMAGE_TAG}" \
  "$@"
