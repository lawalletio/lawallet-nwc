#!/usr/bin/env bash

set -euo pipefail

DOCKERD_LOG=/var/log/dockerd.log
mkdir -p "$(dirname "${DOCKERD_LOG}")"

/usr/local/bin/dockerd-entrypoint.sh >"${DOCKERD_LOG}" 2>&1 &
dockerd_pid=$!

cleanup() {
  if kill -0 "${dockerd_pid}" >/dev/null 2>&1; then
    kill "${dockerd_pid}" >/dev/null 2>&1 || true
    wait "${dockerd_pid}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

for _ in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    "$@"
    exit $?
  fi

  sleep 1
done

echo "Docker daemon did not become ready inside the smoke container." >&2
tail -n 200 "${DOCKERD_LOG}" >&2 || true
exit 1
