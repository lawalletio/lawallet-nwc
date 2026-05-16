import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  ensureCloneTargetAvailable,
  getWebDir,
  resolveInstallTarget
} from '../lib/paths.js'
import {
  DEFAULT_APP_PORT,
  DEFAULT_DOCS_PORT,
  DEFAULT_DOCKER_POSTGRES_PORT,
  DEFAULT_MODE,
  DEFAULT_OPENAPI_PORT,
  DEFAULT_REPO_URL,
  DEFAULT_WEB_PORT,
  createComposeProjectName,
  createDatabaseName,
  createDatabasePassword,
  createDatabaseUser,
  createInstanceId,
  createJwtSecret
} from '../lib/shared.js'
import {
  commandExists,
  findAvailablePort,
  isPortAvailable,
  runCommand
} from '../lib/process.js'
import { promptConfirm, promptText } from '../lib/prompt.js'
import {
  buildInstallState,
  writeInstallState,
  writeNativeEnvFile,
  writeRootEnvFile
} from '../lib/state.js'
import {
  cloneRepository,
  detectPackageManager,
  detectRequestedMode,
  ensureGitInstalled,
  ensurePnpmInstalled,
  ensureWorkspaceInstalled
} from '../lib/system.js'
import {
  detectDockerEnvironment,
  printDockerStatus,
  startDockerStack
} from '../lib/docker.js'
import {
  ensureNativePostgresReady,
  printStatusSummary,
  startNativeRuntime
} from '../lib/native-service.js'

function parsePort(value, label) {
  const port = Number.parseInt(String(value), 10)

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${label} must be a valid TCP port.`)
  }

  return port
}

async function findAvailableDistinctPort(startPort, reservedPorts, attempts = 50) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset

    if (reservedPorts.has(port)) {
      continue
    }

    if (await isPortAvailable(port)) {
      return port
    }
  }

  throw new Error(`Could not find an available port starting at ${startPort}.`)
}

function assertDistinctPorts(entries) {
  const seen = new Map()

  for (const [label, port] of entries) {
    if (port === undefined) {
      continue
    }

    const existing = seen.get(port)

    if (existing) {
      throw new Error(`${label} must not reuse port ${port}; it is already assigned to ${existing}.`)
    }

    seen.set(port, label)
  }
}

function parseInstallArguments(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      dir: { type: 'string', short: 'd' },
      mode: { type: 'string' },
      repo: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      'app-port': { type: 'string' },
      'docs-port': { type: 'string' },
      'openapi-port': { type: 'string' },
      'postgres-port': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  })

  if (values.help) {
    return { help: true }
  }

  if (positionals.length > 1) {
    throw new Error('Expected at most one positional argument for the install directory.')
  }

  const mode = values.mode || DEFAULT_MODE

  if (!['auto', 'docker', 'native'].includes(mode)) {
    throw new Error('Install mode must be one of: auto, docker, native.')
  }

  return {
    help: false,
    dir: values.dir || positionals[0],
    mode,
    repo: values.repo || process.env.LAWALLET_REPO_URL || DEFAULT_REPO_URL,
    yes: values.yes ?? false,
    appPort: values['app-port']
      ? parsePort(values['app-port'], 'The app port')
      : undefined,
    docsPort: values['docs-port']
      ? parsePort(values['docs-port'], 'The docs port')
      : undefined,
    openapiPort: values['openapi-port']
      ? parsePort(values['openapi-port'], 'The OpenAPI port')
      : undefined,
    postgresPort: values['postgres-port']
      ? parsePort(values['postgres-port'], 'The Postgres port')
      : undefined
  }
}

function printInstallHelp() {
  console.log(`lawallet install

Usage:
  lawallet install [--dir <path>] [--mode auto|docker|native] [--repo <url>] [--yes]
    [--app-port <port>] [--docs-port <port>] [--openapi-port <port>] [--postgres-port <port>]
`)
}

export async function runInstallCommand(args) {
  const options = parseInstallArguments(args)

  if (options.help) {
    printInstallHelp()
    return
  }

  const repoName = path.basename(options.repo.replace(/\/+$/, '')).replace(/\.git$/, '')
  const baseDirInput =
    options.dir ||
    (await promptText({
      message: `Base directory for the ${repoName} install`,
      defaultValue: '.',
      skipPrompt: options.yes
    }))

  const target = resolveInstallTarget(baseDirInput, options.repo)
  const packageManager = await detectPackageManager()

  console.log(`\nPreparing LaWallet in ${target.targetDir}`)

  await ensureGitInstalled({ packageManager, autoApprove: options.yes })
  await ensureCloneTargetAvailable(target.targetDir)
  await mkdir(target.baseDir, { recursive: true })
  await cloneRepository(options.repo, target.targetDir)

  const dockerEnvironment =
    options.mode === 'native' ? null : await detectDockerEnvironment()
  const installMode = detectRequestedMode(options.mode, dockerEnvironment)

  await ensurePnpmInstalled()

  if (installMode === 'native') {
    await ensureWorkspaceInstalled(target.targetDir)
  }

  if (installMode === 'native' && options.mode === 'auto' && !options.yes) {
    const confirmed = await promptConfirm({
      message:
        'Docker was not available, so LaWallet will install PostgreSQL natively. Continue?',
      defaultValue: true
    })

    if (!confirmed) {
      throw new Error('Install cancelled by user.')
    }
  }

  const instanceId = createInstanceId(target.targetDir)
  const appPort =
    options.appPort ||
    (await findAvailablePort(
      installMode === 'docker' ? DEFAULT_APP_PORT : DEFAULT_WEB_PORT
    ))
  const reservedPorts = new Set([appPort])
  const docsPort =
    options.docsPort || (await findAvailableDistinctPort(DEFAULT_DOCS_PORT, reservedPorts))
  reservedPorts.add(docsPort)
  const openapiPort =
    options.openapiPort ||
    (await findAvailableDistinctPort(DEFAULT_OPENAPI_PORT, reservedPorts))
  reservedPorts.add(openapiPort)
  const postgresPort =
    installMode === 'docker'
      ? options.postgresPort ||
        (await findAvailableDistinctPort(DEFAULT_DOCKER_POSTGRES_PORT, reservedPorts))
      : DEFAULT_DOCKER_POSTGRES_PORT

  assertDistinctPorts([
    ['The web app port', appPort],
    ['The docs port', docsPort],
    ['The OpenAPI port', openapiPort],
    ['The Postgres port', postgresPort]
  ])

  const state = buildInstallState({
    repoRoot: target.targetDir,
    mode: installMode,
    appPort,
    docsPort,
    openapiPort,
    postgresPort,
    postgresUser: createDatabaseUser(instanceId),
    postgresPassword: createDatabasePassword(),
    postgresDatabase: createDatabaseName(instanceId),
    jwtSecret: createJwtSecret(),
    composeProjectName: createComposeProjectName(instanceId)
  })

  await writeInstallState(target.targetDir, state)
  await writeNativeEnvFile(target.targetDir, state)

  if (installMode === 'docker') {
    await writeRootEnvFile(target.targetDir, state)
    await startDockerStack(state, dockerEnvironment)
  } else {
    await ensureNativePostgresReady({
      state,
      packageManager,
      autoApprove: options.yes
    })

    await runCommand('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: getWebDir(target.targetDir)
    })
    await startNativeRuntime(state)
  }

  console.log('\nLaWallet is installed and starting up.\n')

  if (installMode === 'docker') {
    await printDockerStatus(state, dockerEnvironment)
  } else {
    await printStatusSummary(state)
  }

  if (commandExists('pnpm')) {
    console.log(`\nNext steps:
  cd ${target.targetDir}
  cd apps/web && pnpm service status`)
  }
}
