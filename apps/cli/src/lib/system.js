import { readFile } from 'node:fs/promises'
import { commandExists, runCommand } from './process.js'
import { promptConfirm } from './prompt.js'

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

export async function detectPackageManager() {
  if (process.platform === 'darwin') {
    return {
      platform: process.platform,
      manager: commandExists('brew') ? 'brew' : null,
      distro: 'macos'
    }
  }

  if (process.platform !== 'linux') {
    return {
      platform: process.platform,
      manager: null,
      distro: process.platform
    }
  }

  let distro = 'linux'

  try {
    const osRelease = await readFile('/etc/os-release', 'utf8')
    const match = osRelease.match(/^ID=(.+)$/m)

    if (match) {
      distro = match[1].replace(/"/g, '')
    }
  } catch {}

  if (commandExists('apt-get')) {
    return { platform: process.platform, manager: 'apt', distro }
  }

  if (commandExists('dnf')) {
    return { platform: process.platform, manager: 'dnf', distro }
  }

  if (commandExists('yum')) {
    return { platform: process.platform, manager: 'yum', distro }
  }

  if (commandExists('pacman')) {
    return { platform: process.platform, manager: 'pacman', distro }
  }

  if (commandExists('apk')) {
    return { platform: process.platform, manager: 'apk', distro }
  }

  return {
    platform: process.platform,
    manager: null,
    distro
  }
}

async function runInstallPlan(steps, description, autoApprove) {
  if (steps.length === 0) {
    throw new Error(`No install plan is available for ${description} on this platform.`)
  }

  if (!(await promptConfirm({
    message: `Install ${description} on this machine?`,
    defaultValue: true,
    skipPrompt: autoApprove
  }))) {
    throw new Error(`Cancelled while installing ${description}.`)
  }

  for (const step of steps) {
    await runCommand(step.command, step.args)
  }
}

function buildGitInstallPlan(packageManager) {
  switch (packageManager.manager) {
    case 'brew':
      return [{ command: 'brew', args: ['install', 'git'] }]
    case 'apt':
      return [
        withSudo('apt-get', ['update']),
        withSudo('apt-get', ['install', '-y', 'git'])
      ]
    case 'dnf':
      return [withSudo('dnf', ['install', '-y', 'git'])]
    case 'yum':
      return [withSudo('yum', ['install', '-y', 'git'])]
    case 'pacman':
      return [withSudo('pacman', ['-Sy', '--noconfirm', 'git'])]
    case 'apk':
      return [withSudo('apk', ['add', 'git'])]
    default:
      return []
  }
}

export async function ensureGitInstalled({ packageManager, autoApprove }) {
  if (commandExists('git')) {
    return
  }

  await runInstallPlan(
    buildGitInstallPlan(packageManager),
    'git',
    autoApprove
  )
}

export async function ensurePnpmInstalled() {
  if (commandExists('pnpm')) {
    return
  }

  if (commandExists('corepack')) {
    await runCommand('corepack', ['enable'])
    await runCommand('corepack', ['prepare', 'pnpm@10.11.0', '--activate'])
    return
  }

  if (!commandExists('npm')) {
    throw new Error('pnpm is required, but neither corepack nor npm is available.')
  }

  await runCommand('npm', ['install', '--global', 'pnpm@10.11.0'])
}

export async function ensureWorkspaceInstalled(repoRoot) {
  await runCommand('pnpm', ['install'], {
    cwd: repoRoot
  })
}

export async function cloneRepository(repoSource, targetDir) {
  await runCommand('git', ['clone', repoSource, targetDir])
}

export function detectRequestedMode(requestedMode, dockerEnvironment) {
  if (requestedMode === 'docker') {
    if (!dockerEnvironment) {
      throw new Error('Docker mode was requested, but Docker is not available.')
    }

    return 'docker'
  }

  if (requestedMode === 'native') {
    return 'native'
  }

  return dockerEnvironment ? 'docker' : 'native'
}
