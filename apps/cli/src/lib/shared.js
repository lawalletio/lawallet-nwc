import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'

export const DEFAULT_REPO_URL = 'https://github.com/lawalletio/lawallet-nwc.git'
export const DEFAULT_MODE = 'auto'
export const DEFAULT_APP_PORT = 2288
export const DEFAULT_WEB_PORT = 2288
export const DEFAULT_DOCS_PORT = 3000
export const DEFAULT_OPENAPI_PORT = 4500
export const DEFAULT_DOCKER_POSTGRES_PORT = 5432
export const DEFAULT_POSTGRES_HOST = '127.0.0.1'
export const DEFAULT_POSTGRES_PORT = 5432
export const DEFAULT_POSTGRES_ADMIN_DB = 'postgres'
export const STATE_DIRNAME = '.lawallet'
export const STATE_FILENAME = 'install-state.json'
export const PID_FILENAME = 'lawallet-web.pid'
export const LOG_FILENAME = 'lawallet-web.log'

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'lawallet'
}

export function deriveRepoDirectoryName(repoSource) {
  const trimmed = repoSource.replace(/\/+$/, '')

  if (!trimmed) {
    return 'lawallet-nwc'
  }

  const basename = path.posix
    .basename(trimmed.replace(/\\/g, '/'))
    .replace(/\.git$/, '')

  return basename || 'lawallet-nwc'
}

export function createInstanceId(targetDir) {
  const basename = slugify(path.basename(targetDir))
  const hash = createHash('sha256').update(targetDir).digest('hex').slice(0, 8)

  return `${basename}_${hash}`.slice(0, 32)
}

export function createDatabaseName(instanceId) {
  return `lawallet_${instanceId}`.slice(0, 63)
}

export function createDatabaseUser(instanceId) {
  return `lawallet_${instanceId}`.slice(0, 63)
}

export function createDatabasePassword() {
  return randomBytes(18).toString('base64url')
}

export function createJwtSecret() {
  return randomBytes(32).toString('base64url')
}

export function createComposeProjectName(instanceId) {
  return `lawallet_${instanceId}`.slice(0, 63)
}

export function buildDatabaseUrl(state) {
  return `postgresql://${state.postgres.user}:${state.postgres.password}@${state.postgres.host}:${state.postgres.port}/${state.postgres.database}`
}

export function buildAppUrl(port) {
  return `http://127.0.0.1:${port}`
}

export function buildAppHealthUrl(port) {
  return `${buildAppUrl(port)}/api/health`
}

export function buildDocsHealthUrl(port) {
  return `${buildAppUrl(port)}/api/health`
}

export function buildOpenApiHealthUrl(port) {
  return `${buildAppUrl(port)}/health`
}
