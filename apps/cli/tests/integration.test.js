import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')
const cliEntry = path.join(repoRoot, 'apps/cli/src/index.js')
const bootstrapScript = path.join(repoRoot, 'scripts/install-lawallet-cli.sh')

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function createExecutable(filePath, contents) {
  await writeFile(filePath, contents, 'utf8')
  await chmod(filePath, 0o755)
}

async function runProcess(command, args, options = {}) {
  const { cwd, env, allowFailure = false } = options

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', code => {
      const result = {
        code: code ?? 0,
        stdout,
        stderr
      }

      if (code === 0 || allowFailure) {
        resolve(result)
        return
      }

      reject(
        new Error(
          `Command failed (${command} ${args.join(' ')}): ${stderr || stdout || `exit ${code}`}`
        )
      )
    })
  })
}

async function createFixtureRepo(parentDir) {
  const repoDir = path.join(parentDir, 'lawallet-nwc')

  await mkdir(path.join(repoDir, 'apps/web'), { recursive: true })

  await writeFile(
    path.join(repoDir, 'pnpm-workspace.yaml'),
    "packages:\n  - 'apps/*'\n",
    'utf8'
  )
  await writeFile(
    path.join(repoDir, 'package.json'),
    JSON.stringify(
      {
        name: 'lawallet-fixture',
        private: true,
        packageManager: 'pnpm@10.11.0'
      },
      null,
      2
    ),
    'utf8'
  )
  await writeFile(
    path.join(repoDir, 'docker-compose.yml'),
    "version: '3.8'\nservices: {}\n",
    'utf8'
  )
  await writeFile(
    path.join(repoDir, 'apps/web/package.json'),
    JSON.stringify(
      {
        name: '@lawallet-nwc/web',
        private: true,
        scripts: {
          start: 'next start',
          build: 'next build'
        }
      },
      null,
      2
    ),
    'utf8'
  )

  return repoDir
}

async function createFakeTools(parentDir, options = {}) {
  const fakeBinDir = path.join(parentDir, 'fake-bin')
  const toolStateDir = path.join(parentDir, 'tool-state')

  await mkdir(fakeBinDir, { recursive: true })
  await mkdir(toolStateDir, { recursive: true })

  await createExecutable(
    path.join(fakeBinDir, 'git'),
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "clone" ]]; then
  src="\${2:?}"
  dest="\${3:?}"
  mkdir -p "$(dirname "$dest")"
  cp -R "$src" "$dest"
  exit 0
fi

echo "unsupported fake git invocation: $*" >&2
exit 1
`
  )

  await createExecutable(
    path.join(fakeBinDir, 'pnpm'),
    `#!/usr/bin/env bash
set -euo pipefail

command="\${1:-}"

case "$command" in
  install)
    mkdir -p "$PWD/node_modules" "$PWD/apps/web/node_modules"
    exit 0
    ;;
  exec)
    if [[ "\${2:-}" == "prisma" && "\${3:-}" == "migrate" && "\${4:-}" == "deploy" ]]; then
      exit 0
    fi
    ;;
  build)
    mkdir -p "$PWD/.next"
    exit 0
    ;;
  start)
    exec /bin/sleep 300
    ;;
esac

echo "unsupported fake pnpm invocation: $*" >&2
exit 1
`
  )

  await createExecutable(
    path.join(fakeBinDir, 'pg_isready'),
    `#!/usr/bin/env bash
exit 0
`
  )

  await createExecutable(
    path.join(fakeBinDir, 'psql'),
    `#!/usr/bin/env bash
set -euo pipefail

sql="\${*: -1}"
flag="${toolStateDir}/native-db-created"

if [[ "$sql" == *"SELECT 1 FROM pg_database"* ]]; then
  if [[ -f "$flag" ]]; then
    printf '1\\n'
  fi
  exit 0
fi

if [[ "$sql" == *"CREATE DATABASE"* ]]; then
  mkdir -p "$(dirname "$flag")"
  : > "$flag"
  exit 0
fi

exit 0
`
  )

  for (const command of [
    'brew',
    'apt-get',
    'dnf',
    'yum',
    'pacman',
    'apk',
    'systemctl',
    'service',
    'rc-service',
    'postgresql-setup'
  ]) {
    await createExecutable(
      path.join(fakeBinDir, command),
      `#!/usr/bin/env bash
exit 0
`
    )
  }

  await createExecutable(
    path.join(fakeBinDir, 'sudo'),
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "-u" ]]; then
  shift 2
fi

exec "$@"
`
  )

  await createExecutable(
    path.join(fakeBinDir, 'runuser'),
    `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "-u" ]]; then
  shift 2
fi

if [[ "\${1:-}" == "--" ]]; then
  shift
fi

exec "$@"
`
  )

  if (options.includeDocker) {
    await createExecutable(
      path.join(fakeBinDir, 'docker'),
      `#!/usr/bin/env bash
set -euo pipefail

pid_file="$PWD/.lawallet/fake-docker.pid"
mkdir -p "$PWD/.lawallet"

parse_port() {
  sed -n 's/^PORT=\\([0-9][0-9]*\\)$/\\1/p' "$PWD/.env" | head -n 1
}

case "\${1:-}" in
  info)
    exit 0
    ;;
  compose)
    case "\${2:-}" in
      version)
        printf 'Docker Compose version v2\\n'
        exit 0
        ;;
      up)
        if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
          exit 0
        fi
        /bin/sleep 300 >/dev/null 2>&1 &
        echo $! > "$pid_file"
        exit 0
        ;;
      ps)
        if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
          printf '[{"Name":"lawallet-web","Service":"web","State":"running"},{"Name":"lawallet-postgres","Service":"postgres","State":"running"}]\\n'
        else
          printf '[]\\n'
        fi
        exit 0
        ;;
      stop)
        if [[ -f "$pid_file" ]]; then
          kill "$(cat "$pid_file")" 2>/dev/null || true
          rm -f "$pid_file"
        fi
        exit 0
        ;;
    esac
    ;;
esac

echo "unsupported fake docker invocation: $*" >&2
exit 1
`
    )
  }

  if (options.includeNpm) {
    await createExecutable(
      path.join(fakeBinDir, 'npm'),
      `#!/usr/bin/env bash
set -euo pipefail

if [[ "\${1:-}" == "install" && "\${2:-}" == "--global" ]]; then
  bin_dir="$(cd -- "$(dirname "$0")" && pwd)"
  cat > "$bin_dir/lawallet" <<'EOF'
#!/usr/bin/env bash
exec "$LAWALLET_TEST_NODE_BIN" "$LAWALLET_TEST_CLI_SRC" "$@"
EOF
  chmod +x "$bin_dir/lawallet"
  exit 0
fi

echo "unsupported fake npm invocation: $*" >&2
exit 1
`
    )
  }

  return {
    fakeBinDir,
    toolStateDir
  }
}

function buildTestEnv(fakeTools) {
  return {
    PATH: `${fakeTools.fakeBinDir}:${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    LAWALLET_TEST_NODE_BIN: process.execPath,
    LAWALLET_TEST_CLI_SRC: cliEntry,
    LAWALLET_SKIP_HTTP_WAIT: 'true'
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

test(
  'CLI install exercises the Docker flow and service lifecycle',
  { timeout: 30_000 },
  async t => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lawallet-cli-docker-'))
    t.after(async () => {
      await rm(tempRoot, { recursive: true, force: true })
    })

    const fixtureRoot = path.join(tempRoot, 'fixture')
    await mkdir(fixtureRoot, { recursive: true })
    const fixtureRepo = await createFixtureRepo(fixtureRoot)
    const fakeTools = await createFakeTools(tempRoot, { includeDocker: true })
    const env = buildTestEnv(fakeTools)
    const appPort = 38181
    const postgresPort = 45432

    const install = await runProcess(
      process.execPath,
      [
        cliEntry,
        'install',
        '--mode',
        'docker',
        '--yes',
        '--dir',
        './installs',
        '--repo',
        fixtureRepo,
        '--app-port',
        String(appPort),
        '--postgres-port',
        String(postgresPort)
      ],
      {
        cwd: tempRoot,
        env
      }
    )

    assert.match(install.stdout, /Mode: docker/)
    assert.match(install.stdout, new RegExp(`URL: http://127\\.0\\.0\\.1:${appPort}`))

    const installedRepo = path.join(tempRoot, 'installs', 'lawallet-nwc')
    const state = await readJson(
      path.join(installedRepo, '.lawallet', 'install-state.json')
    )
    const rootEnv = await readFile(path.join(installedRepo, '.env'), 'utf8')
    const webEnv = await readFile(path.join(installedRepo, 'apps/web/.env'), 'utf8')

    assert.equal(state.mode, 'docker')
    assert.equal(state.app.port, appPort)
    assert.equal(state.postgres.port, postgresPort)
    assert.match(rootEnv, new RegExp(`^PORT=${appPort}$`, 'm'))
    assert.match(rootEnv, new RegExp(`^POSTGRES_PORT=${postgresPort}$`, 'm'))
    assert.match(webEnv, new RegExp(`^PORT="${appPort}"$`, 'm'))

    const serviceStatus = await runProcess(
      process.execPath,
      [cliEntry, 'service', 'status', '--cwd', path.join(installedRepo, 'apps/web')],
      {
        env
      }
    )
    assert.match(serviceStatus.stdout, /Mode: docker/)
    assert.match(serviceStatus.stdout, /Containers:/)

    const stop = await runProcess(
      process.execPath,
      [cliEntry, 'service', 'stop', '--cwd', installedRepo],
      {
        env
      }
    )
    assert.match(stop.stdout, /Mode: docker/)
    assert.equal(
      await pathExists(path.join(installedRepo, '.lawallet', 'fake-docker.pid')),
      false
    )

    const restart = await runProcess(
      process.execPath,
      [cliEntry, 'service', 'restart', '--cwd', installedRepo],
      {
        env
      }
    )
    assert.match(restart.stdout, /lawallet-web/)

    await runProcess(
      process.execPath,
      [cliEntry, 'service', 'stop', '--cwd', installedRepo],
      {
        env
      }
    )
  }
)

test(
  'CLI install exercises the native Postgres flow and service lifecycle',
  { timeout: 30_000 },
  async t => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lawallet-cli-native-'))
    t.after(async () => {
      await rm(tempRoot, { recursive: true, force: true })
    })

    const fixtureRoot = path.join(tempRoot, 'fixture')
    await mkdir(fixtureRoot, { recursive: true })
    const fixtureRepo = await createFixtureRepo(fixtureRoot)
    const fakeTools = await createFakeTools(tempRoot)
    const env = buildTestEnv(fakeTools)
    const appPort = 38182

    const install = await runProcess(
      process.execPath,
      [
        cliEntry,
        'install',
        '--mode',
        'native',
        '--yes',
        '--dir',
        './native-installs',
        '--repo',
        fixtureRepo,
        '--app-port',
        String(appPort)
      ],
      {
        cwd: tempRoot,
        env
      }
    )

    assert.match(install.stdout, /Mode: native/)
    assert.match(install.stdout, /Process: running/)

    const installedRepo = path.join(tempRoot, 'native-installs', 'lawallet-nwc')
    const state = await readJson(
      path.join(installedRepo, '.lawallet', 'install-state.json')
    )
    const pidFile = path.join(installedRepo, '.lawallet', 'lawallet-web.pid')
    const webEnv = await readFile(path.join(installedRepo, 'apps/web/.env'), 'utf8')

    assert.equal(state.mode, 'native')
    assert.equal(state.app.port, appPort)
    assert.equal(await pathExists(pidFile), true)
    assert.match(webEnv, /^NODE_ENV="production"$/m)

    const status = await runProcess(
      process.execPath,
      [cliEntry, 'service', 'status', '--cwd', path.join(installedRepo, 'apps/web')],
      {
        env
      }
    )
    assert.match(status.stdout, /Mode: native/)
    assert.match(status.stdout, /Database ready: yes/)

    const restart = await runProcess(
      process.execPath,
      [cliEntry, 'service', 'restart', '--cwd', installedRepo],
      {
        env
      }
    )
    assert.match(restart.stdout, /Process: running/)

    await runProcess(
      process.execPath,
      [cliEntry, 'service', 'stop', '--cwd', installedRepo],
      {
        env
      }
    )

    const stopped = await runProcess(
      process.execPath,
      [cliEntry, 'service', 'status', '--cwd', installedRepo],
      {
        env
      }
    )
    assert.match(stopped.stdout, /Process: stopped/)
    assert.equal(await pathExists(pidFile), false)
  }
)

test(
  'bootstrap script installs the CLI and defaults install location to the current directory',
  { timeout: 30_000 },
  async t => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lawallet-cli-bootstrap-'))
    t.after(async () => {
      await rm(tempRoot, { recursive: true, force: true })
    })

    const fixtureRoot = path.join(tempRoot, 'fixture')
    await mkdir(fixtureRoot, { recursive: true })
    const fixtureRepo = await createFixtureRepo(fixtureRoot)
    const fakeTools = await createFakeTools(tempRoot, {
      includeDocker: true,
      includeNpm: true
    })
    const env = {
      ...buildTestEnv(fakeTools),
      LAWALLET_CLI_REPO_URL: fixtureRepo
    }
    const appPort = 38183
    const postgresPort = 45433

    const bootstrap = await runProcess(
      'bash',
      [
        bootstrapScript,
        '--mode',
        'docker',
        '--yes',
        '--app-port',
        String(appPort),
        '--postgres-port',
        String(postgresPort)
      ],
      {
        cwd: tempRoot,
        env
      }
    )

    const installedRepo = path.join(tempRoot, 'lawallet-nwc')
    const state = await readJson(
      path.join(installedRepo, '.lawallet', 'install-state.json')
    )

    assert.match(bootstrap.stdout, /Installing the local LaWallet CLI package globally/)
    assert.match(bootstrap.stdout, /Mode: docker/)
    assert.equal(state.mode, 'docker')
    assert.equal(state.app.port, appPort)

    await runProcess(
      process.execPath,
      [cliEntry, 'service', 'stop', '--cwd', installedRepo],
      {
        env
      }
    )
  }
)
