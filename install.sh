#!/usr/bin/env bash

set -euo pipefail

LAWALLET_HOME="${LAWALLET_HOME:-${HOME:+${HOME}/.lawallet}}"
LAWALLET_HOME="${LAWALLET_HOME:-$PWD/.lawallet}"
LAWALLET_CLI_NPM_SPEC="${LAWALLET_CLI_NPM_SPEC:-@lawallet-nwc/cli@latest}"
LAWALLET_INSTALL_NODE_VERSION="${LAWALLET_INSTALL_NODE_VERSION:-22.14.0}"
LAWALLET_MIN_NODE_VERSION="${LAWALLET_MIN_NODE_VERSION:-20.13.0}"
LAWALLET_INSTALL_SKIP_PROFILE="${LAWALLET_INSTALL_SKIP_PROFILE:-false}"
LAWALLET_INSTALL_SKIP_RUN="${LAWALLET_INSTALL_SKIP_RUN:-false}"
LAWALLET_INSTALL_FORCE_NODE_DOWNLOAD="${LAWALLET_INSTALL_FORCE_NODE_DOWNLOAD:-false}"

CLI_PREFIX="${LAWALLET_HOME}/npm"
BIN_DIR="${LAWALLET_HOME}/bin"
ENV_FILE="${LAWALLET_HOME}/env"
RUNTIME_ROOT="${LAWALLET_HOME}/runtime"

log() {
  printf '==> %s\n' "$1"
}

warn() {
  printf 'Warning: %s\n' "$1" >&2
}

fail() {
  printf 'LaWallet installer error: %s\n' "$1" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

is_true() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_command() {
  local command_name="$1"

  if ! command_exists "${command_name}"; then
    fail "Missing required command: ${command_name}"
  fi
}

check_node_version() {
  local node_bin="$1"

  LAWALLET_MIN_NODE_VERSION="${LAWALLET_MIN_NODE_VERSION}" "${node_bin}" -e '
const parse = value => value.split(".").map(part => Number.parseInt(part, 10) || 0)
const current = parse(process.versions.node)
const minimum = parse(process.env.LAWALLET_MIN_NODE_VERSION || "20.13.0")

for (let index = 0; index < Math.max(current.length, minimum.length); index += 1) {
  const currentPart = current[index] || 0
  const minimumPart = minimum[index] || 0

  if (currentPart > minimumPart) {
    process.exit(0)
  }

  if (currentPart < minimumPart) {
    process.exit(1)
  }
}

process.exit(0)
'
}

detect_node_platform() {
  case "$(uname -s)" in
    Darwin)
      printf 'darwin'
      ;;
    Linux)
      printf 'linux'
      ;;
    *)
      fail "Only macOS and Linux are supported by this installer."
      ;;
  esac
}

detect_node_arch() {
  case "$(uname -m)" in
    x86_64|amd64)
      printf 'x64'
      ;;
    arm64|aarch64)
      printf 'arm64'
      ;;
    *)
      fail "Unsupported CPU architecture: $(uname -m)"
      ;;
  esac
}

download_to_file() {
  local url="$1"
  local destination="$2"

  if command_exists curl; then
    curl -fsSL "${url}" -o "${destination}"
    return
  fi

  if command_exists wget; then
    wget -qO "${destination}" "${url}"
    return
  fi

  fail "curl or wget is required to download the bundled Node.js runtime."
}

install_bundled_node() {
  local platform arch runtime_name node_dir archive_url archive_path temp_dir

  require_command tar

  platform="$(detect_node_platform)"
  arch="$(detect_node_arch)"
  runtime_name="node-v${LAWALLET_INSTALL_NODE_VERSION}-${platform}-${arch}"
  node_dir="${RUNTIME_ROOT}/${runtime_name}"

  if [ -x "${node_dir}/bin/node" ] && [ -x "${node_dir}/bin/npm" ]; then
    NODE_BIN="${node_dir}/bin/node"
    NPM_BIN="${node_dir}/bin/npm"
    NODE_BIN_DIR="${node_dir}/bin"
    return
  fi

  archive_url="https://nodejs.org/dist/v${LAWALLET_INSTALL_NODE_VERSION}/${runtime_name}.tar.xz"
  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/lawallet-install.XXXXXX")"
  archive_path="${temp_dir}/${runtime_name}.tar.xz"

  mkdir -p "${RUNTIME_ROOT}"

  log "Installing bundled Node.js v${LAWALLET_INSTALL_NODE_VERSION}"
  download_to_file "${archive_url}" "${archive_path}"
  rm -rf "${node_dir}.tmp"
  mkdir -p "${node_dir}.tmp"
  tar -xf "${archive_path}" -C "${node_dir}.tmp" --strip-components=1
  rm -rf "${node_dir}"
  mv "${node_dir}.tmp" "${node_dir}"
  rm -rf "${temp_dir}"

  NODE_BIN="${node_dir}/bin/node"
  NPM_BIN="${node_dir}/bin/npm"
  NODE_BIN_DIR="${node_dir}/bin"
}

select_node_runtime() {
  if ! is_true "${LAWALLET_INSTALL_FORCE_NODE_DOWNLOAD}" &&
    command_exists node &&
    command_exists npm &&
    check_node_version "$(command -v node)"; then
    NODE_BIN="$(command -v node)"
    NPM_BIN="$(command -v npm)"
    NODE_BIN_DIR="$(dirname "${NODE_BIN}")"
    return
  fi

  if command_exists node && ! check_node_version "$(command -v node)"; then
    warn "Node.js $(node -v 2>/dev/null || printf 'unknown') is installed, but LaWallet needs ${LAWALLET_MIN_NODE_VERSION}+ for the CLI bootstrap."
  fi

  install_bundled_node
}

write_env_file() {
  mkdir -p "${LAWALLET_HOME}" "${BIN_DIR}"

  cat > "${ENV_FILE}" <<EOF
export LAWALLET_HOME="${LAWALLET_HOME}"
if [ -d "${BIN_DIR}" ]; then
  export PATH="${BIN_DIR}:\$PATH"
fi
EOF
}

detect_profile_file() {
  if [ -n "${LAWALLET_PROFILE:-}" ]; then
    printf '%s' "${LAWALLET_PROFILE}"
    return
  fi

  case "$(basename "${SHELL:-}")" in
    zsh)
      printf '%s/.zshrc' "${HOME}"
      ;;
    bash)
      if [ "$(detect_node_platform)" = 'darwin' ]; then
        printf '%s/.bash_profile' "${HOME}"
      else
        printf '%s/.bashrc' "${HOME}"
      fi
      ;;
    *)
      printf '%s/.profile' "${HOME}"
      ;;
  esac
}

persist_path_update() {
  local profile_file

  if is_true "${LAWALLET_INSTALL_SKIP_PROFILE}"; then
    return
  fi

  profile_file="$(detect_profile_file)"
  mkdir -p "$(dirname "${profile_file}")"
  touch "${profile_file}"

  if grep -Fq '# >>> lawallet >>>' "${profile_file}"; then
    return
  fi

  cat >> "${profile_file}" <<EOF

# >>> lawallet >>>
if [ -f "${ENV_FILE}" ]; then
  . "${ENV_FILE}"
fi
# <<< lawallet <<<
EOF

  log "Updated ${profile_file} so 'lawallet' is available in new shells"
}

install_cli_package() {
  mkdir -p "${CLI_PREFIX}" "${BIN_DIR}"

  log "Installing LaWallet CLI package (${LAWALLET_CLI_NPM_SPEC})"
  "${NPM_BIN}" install --global --prefix "${CLI_PREFIX}" "${LAWALLET_CLI_NPM_SPEC}"

  if [ ! -x "${CLI_PREFIX}/bin/lawallet" ]; then
    fail "Expected the CLI binary at ${CLI_PREFIX}/bin/lawallet after npm install."
  fi

  cat > "${BIN_DIR}/lawallet" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="${NODE_BIN_DIR}:${CLI_PREFIX}/bin:\$PATH"
exec "${CLI_PREFIX}/bin/lawallet" "\$@"
EOF
  chmod +x "${BIN_DIR}/lawallet"
}

print_success_summary() {
  printf '\nLaWallet CLI is installed.\n'
  printf 'CLI path: %s\n' "${BIN_DIR}/lawallet"
  printf 'CLI package: %s\n' "${LAWALLET_CLI_NPM_SPEC}"

  if is_true "${LAWALLET_INSTALL_SKIP_PROFILE}"; then
    printf 'Add this to your shell before using the CLI manually:\n'
    printf '  export PATH="%s:$PATH"\n' "${BIN_DIR}"
  else
    printf 'Open a new shell or run this now if you want the command immediately:\n'
    printf '  export PATH="%s:$PATH"\n' "${BIN_DIR}"
  fi
}

main() {
  select_node_runtime
  write_env_file
  install_cli_package
  persist_path_update
  export PATH="${BIN_DIR}:${PATH}"

  print_success_summary

  if is_true "${LAWALLET_INSTALL_SKIP_RUN}"; then
    printf '\nSkipping `lawallet install` because LAWALLET_INSTALL_SKIP_RUN=true.\n'
    exit 0
  fi

  printf '\nRunning `lawallet install`.\n'
  exec "${BIN_DIR}/lawallet" install "$@"
}

main "$@"
