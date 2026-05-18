import { access, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  deriveRepoDirectoryName,
  STATE_DIRNAME,
  STATE_FILENAME
} from './shared.js'

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

export function resolveInstallTarget(baseInput, repoSource) {
  const baseDir = path.resolve(process.cwd(), baseInput || '.')
  const repoDirName = deriveRepoDirectoryName(repoSource)

  return {
    baseDir,
    repoDirName,
    targetDir: path.join(baseDir, repoDirName)
  }
}

export async function ensureCloneTargetAvailable(targetDir) {
  if (!(await pathExists(targetDir))) {
    return
  }

  const entries = await readdir(targetDir)

  if (entries.length > 0) {
    throw new Error(`The target directory already exists and is not empty: ${targetDir}`)
  }
}

export function findRepoRoot(startDir) {
  let current = path.resolve(startDir)

  while (true) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current
    }

    const parent = path.dirname(current)

    if (parent === current) {
      break
    }

    current = parent
  }

  throw new Error('Could not find the LaWallet repository root from the current directory.')
}

export function getLawalletStateDir(repoRoot) {
  return path.join(repoRoot, STATE_DIRNAME)
}

export function getInstallStatePath(repoRoot) {
  return path.join(getLawalletStateDir(repoRoot), STATE_FILENAME)
}

export function getServicePidFilePath(repoRoot, serviceName) {
  return path.join(getLawalletStateDir(repoRoot), `lawallet-${serviceName}.pid`)
}

export function getServiceLogFilePath(repoRoot, serviceName) {
  return path.join(getLawalletStateDir(repoRoot), `lawallet-${serviceName}.log`)
}

export function getPidFilePath(repoRoot) {
  return getServicePidFilePath(repoRoot, 'web')
}

export function getLogFilePath(repoRoot) {
  return getServiceLogFilePath(repoRoot, 'web')
}

export function getWebDir(repoRoot) {
  return path.join(repoRoot, 'apps', 'web')
}

export function getDocsDir(repoRoot) {
  return path.join(repoRoot, 'apps', 'docs')
}

export function getOpenapiDir(repoRoot) {
  return path.join(repoRoot, 'packages', 'openapi')
}
