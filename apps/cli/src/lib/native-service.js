import { access, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import {
  commandExists,
  isProcessRunning,
  runCommand,
  sleep,
  waitForHttp
} from './process.js'
import {
  getDocsDir,
  getOpenapiDir,
  getServiceLogFilePath,
  getServicePidFilePath,
  getWebDir
} from './paths.js'
import { promptConfirm } from './prompt.js'
import { buildDatabaseUrl } from './shared.js'

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

function withSudo(command, args) {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return { command, args }
  }

  if (commandExists('sudo')) {
    return {
      command: 'sudo',
      args: [command, ...args]
    }
  }

  return { command, args }
}

function withPostgresUser(command, args) {
  if (commandExists('sudo')) {
    return {
      command: 'sudo',
      args: ['-u', 'postgres', command, ...args]
    }
  }

  if (commandExists('runuser')) {
    return {
      command: 'runuser',
      args: ['-u', 'postgres', '--', command, ...args]
    }
  }

  return null
}

function buildPostgresInstallSteps(packageManager) {
  switch (packageManager.manager) {
    case 'brew':
      return [
        [{ command: 'brew', args: ['install', 'postgresql@16'] }],
        [{ command: 'brew', args: ['install', 'postgresql'] }]
      ]
    case 'apt':
      return [[
        withSudo('apt-get', ['update']),
        withSudo('apt-get', ['install', '-y', 'postgresql', 'postgresql-contrib'])
      ]]
    case 'dnf':
      return [[
        withSudo('dnf', ['install', '-y', 'postgresql-server', 'postgresql-contrib']),
      ]]
    case 'yum':
      return [[
        withSudo('yum', ['install', '-y', 'postgresql-server', 'postgresql-contrib']),
      ]]
    case 'pacman':
      return [[withSudo('pacman', ['-Sy', '--noconfirm', 'postgresql'])]]
    case 'apk':
      return [[withSudo('apk', ['add', 'postgresql', 'postgresql-client'])]]
    default:
      return []
  }
}

async function ensurePostgresInstalled({ packageManager, autoApprove }) {
  if (commandExists('psql') && commandExists('pg_isready')) {
    return
  }

  const confirmed = await promptConfirm({
    message: 'PostgreSQL is not installed locally. Install it now?',
    defaultValue: true,
    skipPrompt: autoApprove
  })

  if (!confirmed) {
    throw new Error('PostgreSQL installation was cancelled.')
  }

  const steps = buildPostgresInstallSteps(packageManager)

  if (steps.length === 0) {
    throw new Error(
      `Automatic PostgreSQL installation is not supported on ${packageManager.platform}/${packageManager.distro}.`
    )
  }

  let installed = false
  let lastError = null

  for (const plan of steps) {
    try {
      for (const step of plan) {
        await runCommand(step.command, step.args)
      }

      installed = true
      break
    } catch (error) {
      lastError = error
    }
  }

  if (!installed) {
    throw lastError || new Error('Unable to install PostgreSQL.')
  }
}

async function initializePostgresDataDirectory(packageManager) {
  if (packageManager.manager === 'dnf' || packageManager.manager === 'yum') {
    const commands = [
      withSudo('postgresql-setup', ['--initdb']),
      withSudo('postgresql-setup', ['--initdb', '--unit', 'postgresql'])
    ]

    for (const command of commands) {
      try {
        await runCommand(command.command, command.args)
        return
      } catch {}
    }

    return
  }

  if (packageManager.manager === 'pacman') {
    if (await pathExists('/var/lib/postgres/data/PG_VERSION')) {
      return
    }

    const initdb = withPostgresUser('initdb', ['-D', '/var/lib/postgres/data'])

    if (!initdb) {
      return
    }

    await runCommand(initdb.command, initdb.args)
    return
  }

  if (packageManager.manager === 'apk') {
    if (await pathExists('/var/lib/postgresql/data/PG_VERSION')) {
      return
    }

    const mkdirStep = withSudo('mkdir', ['-p', '/var/lib/postgresql/data'])
    const chownStep = withSudo('chown', [
      '-R',
      'postgres:postgres',
      '/var/lib/postgresql'
    ])

    await runCommand(mkdirStep.command, mkdirStep.args)
    await runCommand(chownStep.command, chownStep.args)

    const initdb = withPostgresUser('initdb', ['-D', '/var/lib/postgresql/data'])

    if (!initdb) {
      return
    }

    await runCommand(initdb.command, initdb.args)
  }
}

async function startPostgresService(packageManager) {
  const candidates = []

  if (packageManager.manager === 'brew') {
    candidates.push({ command: 'brew', args: ['services', 'start', 'postgresql@16'] })
    candidates.push({ command: 'brew', args: ['services', 'start', 'postgresql'] })
  } else if (commandExists('systemctl')) {
    candidates.push(withSudo('systemctl', ['enable', '--now', 'postgresql']))
    candidates.push(withSudo('systemctl', ['start', 'postgresql']))
    candidates.push(withSudo('systemctl', ['start', 'postgresql.service']))
  } else if (commandExists('service')) {
    candidates.push(withSudo('service', ['postgresql', 'start']))
  } else if (commandExists('rc-service')) {
    candidates.push(withSudo('rc-service', ['postgresql', 'start']))
  }

  for (const candidate of candidates) {
    try {
      await runCommand(candidate.command, candidate.args)
      return
    } catch {}
  }
}

async function isPostgresReady(state) {
  if (!commandExists('pg_isready')) {
    return false
  }

  const result = await runCommand(
    'pg_isready',
    ['-h', state.postgres.host, '-p', String(state.postgres.port)],
    {
      capture: true,
      allowFailure: true
    }
  )

  return result.code === 0
}

function buildAdminCommands(sql) {
  const direct = {
    command: 'psql',
    args: ['-d', 'postgres', '-tAc', sql]
  }
  const candidates = [direct]

  if (commandExists('sudo')) {
    candidates.push({
      command: 'sudo',
      args: ['-u', 'postgres', 'psql', '-d', 'postgres', '-tAc', sql]
    })
  }

  if (commandExists('runuser')) {
    candidates.push({
      command: 'runuser',
      args: ['-u', 'postgres', '--', 'psql', '-d', 'postgres', '-tAc', sql]
    })
  }

  return candidates
}

async function runAdminSql(sql) {
  const candidates = buildAdminCommands(sql)
  let lastError = null

  for (const candidate of candidates) {
    try {
      const result = await runCommand(candidate.command, candidate.args, {
        capture: true
      })
      return result.stdout
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Unable to run PostgreSQL admin commands.')
}

function escapeSqlLiteral(value) {
  return value.replace(/'/g, "''")
}

async function ensureDatabaseObjects(state) {
  const roleName = state.postgres.user
  const password = escapeSqlLiteral(state.postgres.password)
  const databaseName = state.postgres.database

  await runAdminSql(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${roleName}') THEN
    CREATE ROLE "${roleName}" LOGIN PASSWORD '${password}';
  ELSE
    ALTER ROLE "${roleName}" WITH LOGIN PASSWORD '${password}';
  END IF;
END
$$;
  `)

  const exists = await runAdminSql(
    `SELECT 1 FROM pg_database WHERE datname = '${databaseName}'`
  )

  if (exists.trim() === '1') {
    return
  }

  await runAdminSql(`CREATE DATABASE "${databaseName}" OWNER "${roleName}"`)
}

async function waitForPostgres(state) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < 60_000) {
    if (await isPostgresReady(state)) {
      return
    }

    await sleep(1_500)
  }

  throw new Error('Timed out waiting for PostgreSQL to become ready.')
}

export async function ensureNativePostgresReady({
  state,
  packageManager,
  autoApprove
}) {
  await ensurePostgresInstalled({ packageManager, autoApprove })
  await initializePostgresDataDirectory(packageManager)
  await startPostgresService(packageManager)
  await waitForPostgres(state)
  await ensureDatabaseObjects(state)
}

async function ensureWorkspaceReady(repoRoot) {
  if (await pathExists(path.join(repoRoot, 'node_modules'))) {
    return
  }

  await runCommand('pnpm', ['install'], {
    cwd: repoRoot
  })
}

function getManagedServices(state) {
  return [
    {
      name: 'web',
      cwd: getWebDir(state.repoRoot),
      healthUrl: state.services.web.healthUrl,
      url: state.services.web.url,
      env: {
        NODE_ENV: 'production',
        PORT: String(state.services.web.port),
        JWT_SECRET: state.jwtSecret,
        ...(state.keyVaultSecret
          ? { KEY_VAULT_SECRET: state.keyVaultSecret }
          : {})
      },
      buildBeforeStart: true,
      startArgs: ['start']
    },
    {
      name: 'docs',
      cwd: getDocsDir(state.repoRoot),
      healthUrl: state.services.docs.healthUrl,
      url: state.services.docs.url,
      env: {
        DOCS_HOST: '127.0.0.1',
        NODE_ENV: 'production',
        PORT: String(state.services.docs.port)
      },
      buildBeforeStart: true,
      startArgs: ['start']
    },
    {
      name: 'openapi',
      cwd: getOpenapiDir(state.repoRoot),
      healthUrl: state.services.openapi.healthUrl,
      url: state.services.openapi.url,
      env: {
        NODE_ENV: 'production',
        OPENAPI_HOST: '127.0.0.1',
        OPENAPI_PORT: String(state.services.openapi.port),
        OPENAPI_SERVER_URL: state.services.web.url
      },
      buildBeforeStart: false,
      startArgs: ['start']
    }
  ]
}

async function ensureManagedBuilds(state) {
  for (const service of getManagedServices(state)) {
    if (!service.buildBeforeStart) {
      continue
    }

    await runCommand('pnpm', ['build'], {
      cwd: service.cwd
    })
  }
}

async function readPid(repoRoot, serviceName) {
  try {
    const contents = await readFile(getServicePidFilePath(repoRoot, serviceName), 'utf8')
    const pid = Number.parseInt(contents.trim(), 10)
    return Number.isInteger(pid) ? pid : null
  } catch {
    return null
  }
}

async function writePid(repoRoot, serviceName, pid) {
  await writeFile(getServicePidFilePath(repoRoot, serviceName), `${pid}\n`, 'utf8')
}

async function startManagedService(state, service) {
  const existingPid = await readPid(state.repoRoot, service.name)

  if (existingPid && isProcessRunning(existingPid)) {
    await waitForHttp(service.healthUrl)
    return
  }

  await mkdir(path.dirname(getServiceLogFilePath(state.repoRoot, service.name)), {
    recursive: true
  })

  const logFile = await open(getServiceLogFilePath(state.repoRoot, service.name), 'a')
  const child = spawn('pnpm', service.startArgs, {
    cwd: service.cwd,
    env: {
      ...process.env,
      ...service.env
    },
    detached: true,
    stdio: ['ignore', logFile.fd, logFile.fd]
  })

  child.unref()
  await writePid(state.repoRoot, service.name, child.pid)
  await logFile.close()
  await waitForHttp(service.healthUrl)
}

async function stopManagedService(state, service) {
  const pid = await readPid(state.repoRoot, service.name)

  if (!pid) {
    return
  }

  if (!isProcessRunning(pid)) {
    await rm(getServicePidFilePath(state.repoRoot, service.name), { force: true })
    return
  }

  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    await rm(getServicePidFilePath(state.repoRoot, service.name), { force: true })
    return
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt < 15_000) {
    if (!isProcessRunning(pid)) {
      await rm(getServicePidFilePath(state.repoRoot, service.name), { force: true })
      return
    }

    await sleep(1_000)
  }

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {}

  await rm(getServicePidFilePath(state.repoRoot, service.name), { force: true })
}

async function isHealthUrlReady(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3_000)
    })
    return response.ok
  } catch {
    return false
  }
}

export async function startNativeRuntime(state) {
  await ensureWorkspaceReady(state.repoRoot)
  await ensureManagedBuilds(state)

  for (const service of getManagedServices(state)) {
    await startManagedService(state, service)
  }
}

export async function stopNativeRuntime(state) {
  for (const service of [...getManagedServices(state)].reverse()) {
    await stopManagedService(state, service)
  }
}

export async function restartNativeRuntime(state) {
  await stopNativeRuntime(state)
  await startNativeRuntime(state)
}

export async function printStatusSummary(state) {
  const databaseReady = await isPostgresReady(state)
  const services = await Promise.all(
    getManagedServices(state).map(async service => {
      const pid = await readPid(state.repoRoot, service.name)
      const running = pid ? isProcessRunning(pid) : false
      return {
        ...service,
        pid,
        running,
        healthy: running ? await isHealthUrlReady(service.healthUrl) : false
      }
    })
  )

  console.log(`LaWallet status

Mode: ${state.mode}
Install path: ${state.repoRoot}
Database URL: ${buildDatabaseUrl(state)}
Database ready: ${databaseReady ? 'yes' : 'no'}`)

  console.log('\nServices:')

  for (const service of services) {
    console.log(
      `  - ${service.name}: ${service.running ? `running (pid ${service.pid})` : 'stopped'} ` +
        `${service.running ? `[${service.healthy ? 'healthy' : 'unhealthy'}] ` : ''}` +
        `${service.url} (health: ${service.healthUrl})`
    )
  }

  console.log('\nLog files:')

  for (const service of services) {
    console.log(`  - ${service.name}: ${getServiceLogFilePath(state.repoRoot, service.name)}`)
  }
}
