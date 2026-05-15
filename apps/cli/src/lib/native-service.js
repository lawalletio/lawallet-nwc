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
import { getLogFilePath, getPidFilePath, getWebDir } from './paths.js'
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

async function ensureWebBuild(repoRoot) {
  await runCommand('pnpm', ['build'], {
    cwd: getWebDir(repoRoot)
  })
}

async function readPid(repoRoot) {
  try {
    const contents = await readFile(getPidFilePath(repoRoot), 'utf8')
    const pid = Number.parseInt(contents.trim(), 10)
    return Number.isInteger(pid) ? pid : null
  } catch {
    return null
  }
}

async function writePid(repoRoot, pid) {
  await writeFile(getPidFilePath(repoRoot), `${pid}\n`, 'utf8')
}

export async function startNativeRuntime(state) {
  await ensureWorkspaceReady(state.repoRoot)
  await ensureWebBuild(state.repoRoot)

  const existingPid = await readPid(state.repoRoot)

  if (existingPid && isProcessRunning(existingPid)) {
    return
  }

  await mkdir(path.dirname(getLogFilePath(state.repoRoot)), { recursive: true })

  const logFile = await open(getLogFilePath(state.repoRoot), 'a')
  const child = spawn('pnpm', ['start'], {
    cwd: getWebDir(state.repoRoot),
    detached: true,
    stdio: ['ignore', logFile.fd, logFile.fd]
  })

  child.unref()
  await writePid(state.repoRoot, child.pid)
  await logFile.close()
  await waitForHttp(state.app.healthUrl)
}

export async function stopNativeRuntime(state) {
  const pid = await readPid(state.repoRoot)

  if (!pid) {
    return
  }

  if (!isProcessRunning(pid)) {
    await rm(getPidFilePath(state.repoRoot), { force: true })
    return
  }

  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    await rm(getPidFilePath(state.repoRoot), { force: true })
    return
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt < 15_000) {
    if (!isProcessRunning(pid)) {
      await rm(getPidFilePath(state.repoRoot), { force: true })
      return
    }

    await sleep(1_000)
  }

  try {
    process.kill(-pid, 'SIGKILL')
  } catch {}
  await rm(getPidFilePath(state.repoRoot), { force: true })
}

export async function restartNativeRuntime(state) {
  await stopNativeRuntime(state)
  await startNativeRuntime(state)
}

export async function printStatusSummary(state) {
  const pid = await readPid(state.repoRoot)
  const webRunning = pid ? isProcessRunning(pid) : false
  const databaseReady = await isPostgresReady(state)

  console.log(`LaWallet status

Mode: ${state.mode}
Install path: ${state.repoRoot}
URL: ${state.app.url}
Port: ${state.app.port}
Database URL: ${buildDatabaseUrl(state)}
Database ready: ${databaseReady ? 'yes' : 'no'}
Process: ${webRunning ? `running (pid ${pid})` : 'stopped'}
Log file: ${getLogFilePath(state.repoRoot)}`)
}
