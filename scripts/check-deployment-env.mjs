#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const execFile = promisify(execFileCallback)

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8')
}

function requireMatch(contents, pattern, label) {
  if (!pattern.test(contents)) {
    throw new Error(`Deployment environment check failed: ${label}`)
  }
}

function requireOccurrences(contents, value, minimum, label) {
  const count = contents.split(value).length - 1
  if (count < minimum) {
    throw new Error(
      `Deployment environment check failed: ${label} (found ${count}, expected at least ${minimum})`
    )
  }
}

function exactOccurrenceFailure(contents, value, expected, label) {
  const count = contents.split(value).length - 1
  if (count === expected) return null
  return `${label} (found ${count}, expected exactly ${expected})`
}

function requireCondition(condition, label) {
  if (!condition) {
    throw new Error(`Deployment environment check failed: ${label}`)
  }
}

const UMBREL_RAW_BASE =
  'https://raw.githubusercontent.com/lawalletio/umbrel-app-store/master'
const UMBREL_PACKAGE_FILES = [
  'lawallet-nwc/docker-compose.yml',
  'test/docker-compose.regtest.yml'
]
const UMBREL_PERSISTED_SECRET_CONTRACT = {
  'lawallet-nwc/docker-compose.yml': [
    {
      value: 'NWC_VAULT_SECRET: "${APP_SEED}-nwc-vault-v1"',
      expected: 2,
      label: 'must preserve the v1 NWC vault derivation on web and listener'
    },
    {
      value: 'KEY_VAULT_SECRET: "${APP_SEED}-key-vault-v1"',
      expected: 1,
      label: 'must preserve the v1 user-key vault derivation'
    },
    {
      value: 'LISTENER_REQUEST_AUTH_SECRET: "${APP_SEED}-listener-request-v1"',
      expected: 2,
      label:
        'must pass the domain-separated request-auth secret to web and listener'
    }
  ],
  'test/docker-compose.regtest.yml': [
    {
      value:
        'NWC_VAULT_SECRET: "${APP_SEED:-lawallet-local-jwt-secret-at-least-32-chars}-nwc-vault-v1"',
      expected: 2,
      label: 'must preserve the v1 NWC vault derivation on web and listener'
    },
    {
      value:
        'KEY_VAULT_SECRET: "${APP_SEED:-lawallet-local-jwt-secret-at-least-32-chars}-key-vault-v1"',
      expected: 1,
      label: 'must preserve the v1 user-key vault derivation'
    },
    {
      value:
        'LISTENER_REQUEST_AUTH_SECRET: "${APP_SEED:-lawallet-local-jwt-secret-at-least-32-chars}-listener-request-v1"',
      expected: 2,
      label:
        'must pass the domain-separated request-auth secret to web and listener'
    }
  ]
}

async function readRemote(relativePath) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${UMBREL_RAW_BASE}/${relativePath}`, {
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

function parseDotenv(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      })
  )
}

const [
  sourceCompose,
  publishedCompose,
  netlify,
  readme,
  deployIndex,
  cliInstall,
  cliState,
  devBootstrap,
  webEnvExample,
  environmentGuide,
  packageManifest
] = await Promise.all([
  read('docker-compose.yml'),
  read('docker-compose.hub.yml'),
  read('netlify.toml'),
  read('README.md'),
  read('apps/docs/content/docs/deploy/index.mdx'),
  read('apps/cli/src/commands/install.js'),
  read('apps/cli/src/lib/state.js'),
  read('scripts/dev-worktree.mjs'),
  read('apps/web/.env.example'),
  read('apps/docs/content/docs/deploy/environment.mdx'),
  read('package.json')
])

for (const [contents, label] of [
  [sourceCompose, 'source Compose'],
  [publishedCompose, 'published-image Compose']
]) {
  requireOccurrences(
    contents,
    'NWC_VAULT_SECRET:',
    2,
    `${label} must pass NWC_VAULT_SECRET to web and listener`
  )
  // A default JWT_SECRET is public knowledge — anyone can sign an ADMIN token
  // with it. Both compose files must fail closed when the variable is unset.
  requireMatch(
    contents,
    /\$\{JWT_SECRET:\?/,
    `${label} must require JWT_SECRET via :? (no insecure default)`
  )
  requireCondition(
    !/\$\{JWT_SECRET:-/.test(contents),
    `${label} must not ship a default JWT_SECRET value`
  )
}

// The Umbrel package lives in lawalletio/umbrel-app-store and is only ever
// rewritten by tag-bumping automation, so a newly required variable never
// reaches its env block on its own. v2.1.0 shipped without NWC_VAULT_SECRET
// and crash-looped both containers while this gate stayed green. v2.2.0 then
// changed the APP_SEED suffixes and made already-encrypted NWC/user-key data
// unreadable. Those exact domain tags are therefore a persisted-data contract,
// not merely presence checks.
//
// Strict only where it matters — the release gate sets
// STRICT_EXTERNAL_PACKAGES=1. On ordinary PRs this stays advisory: the Umbrel
// package is a different repository, and its drift must not block unrelated
// work here. It must, however, block shipping. A network failure always skips,
// so a GitHub outage can never break a release either way.
const strictExternalPackages = process.env.STRICT_EXTERNAL_PACKAGES === '1'

for (const packagePath of UMBREL_PACKAGE_FILES) {
  let contents
  try {
    contents = await readRemote(packagePath)
  } catch (error) {
    console.warn(
      `Skipped Umbrel package check for ${packagePath}: ${error.message}`
    )
    continue
  }
  const failures = UMBREL_PERSISTED_SECRET_CONTRACT[packagePath]
    .map(contract =>
      exactOccurrenceFailure(
        contents,
        contract.value,
        contract.expected,
        `Umbrel package ${packagePath} ${contract.label}`
      )
    )
    .filter(Boolean)
  if (failures.length === 0) continue

  if (strictExternalPackages) {
    throw new Error(
      `Deployment environment check failed: ${failures.join('; ')}`
    )
  }
  console.warn(
    `WARNING: ${failures.join('; ')}. Releases stay blocked until lawalletio/umbrel-app-store is updated.`
  )
}

requireMatch(
  netlify,
  /^\s*NWC_VAULT_SECRET\s*=/m,
  'Netlify template must prompt for NWC_VAULT_SECRET'
)

for (const [contents, label] of [
  [readme, 'README Vercel button'],
  [deployIndex, 'docs Vercel button']
]) {
  requireMatch(
    contents,
    /env=JWT_SECRET%2CNWC_VAULT_SECRET/,
    `${label} must request both runtime secrets`
  )
}

requireMatch(
  cliInstall,
  /nwcVaultSecret:\s*createJwtSecret\(\)/,
  'CLI installer must generate a dedicated NWC vault key'
)
requireOccurrences(
  cliState,
  'NWC_VAULT_SECRET=',
  1,
  'CLI state must write the NWC vault key'
)
requireMatch(
  devBootstrap,
  /NWC_VAULT_SECRET:\s*[\s\S]*randomBytes\(48\)/,
  'development bootstrap must generate the NWC vault key'
)
requireMatch(
  webEnvExample,
  /NIP-57 nsec is\s*\n# entered in Admin Settings/,
  'env example must keep the NIP-57 nsec in Admin Settings'
)
for (const variable of [
  'DATABASE_URL',
  'JWT_SECRET',
  'KEY_VAULT_SECRET',
  'NWC_VAULT_SECRET',
  'LISTENER_URL',
  'WEB_ORIGIN',
  'LISTENER_AUTH_SECRET',
  'LISTENER_REQUEST_AUTH_SECRET'
]) {
  requireMatch(
    environmentGuide,
    new RegExp(`\\\`${variable}\\\``),
    `environment guide must explain ${variable}`
  )
}
requireMatch(
  packageManifest,
  /"deploy:env":\s*"bash scripts\/generate-deployment-env\.sh --mode compose"/,
  'package scripts must expose the Compose generator'
)
requireMatch(
  packageManifest,
  /"deploy:env:cloud":\s*"bash scripts\/generate-deployment-env\.sh --mode cloud"/,
  'package scripts must expose the cloud generator'
)

const forbiddenSignerEnv =
  /(?:NIP57|NIP_57|ZAP_RECEIPT|RECEIPT_SIGNER)_(?:NSEC|SECRET|PRIVATE_KEY)\s*=/i
for (const [contents, label] of [
  [sourceCompose, 'source Compose'],
  [publishedCompose, 'published-image Compose'],
  [netlify, 'Netlify template'],
  [webEnvExample, 'web env example']
]) {
  if (forbiddenSignerEnv.test(contents)) {
    throw new Error(
      `Deployment environment check failed: ${label} exposes an environment-based NIP-57 signer`
    )
  }
}

const generator = path.join(root, 'scripts/generate-deployment-env.sh')
const generatedRoot = await mkdtemp(
  path.join(os.tmpdir(), 'lawallet-deployment-env-')
)

try {
  const composeOutput = path.join(generatedRoot, 'compose.env')
  await execFile('bash', [
    generator,
    '--mode',
    'compose',
    '--output',
    composeOutput
  ])

  const composeEnv = parseDotenv(await readFile(composeOutput, 'utf8'))
  const generatedSecrets = [
    'POSTGRES_PASSWORD',
    'JWT_SECRET',
    'KEY_VAULT_SECRET',
    'NWC_VAULT_SECRET',
    'LISTENER_AUTH_SECRET',
    'LISTENER_REQUEST_AUTH_SECRET'
  ].map(name => composeEnv[name])

  requireCondition(
    generatedSecrets.every(value => /^[a-f0-9]{64}$/.test(value ?? '')),
    'generator must create 32-byte hexadecimal secrets'
  )
  requireCondition(
    new Set(generatedSecrets).size === generatedSecrets.length,
    'generator must create independent secrets'
  )
  requireCondition(
    composeEnv.COMPOSE_PROFILES === 'listener' &&
      composeEnv.LISTENER_URL === 'http://listener:4100',
    'compose output must enable and connect the listener'
  )
  requireCondition(
    ((await stat(composeOutput)).mode & 0o777) === 0o600,
    'compose output must be mode 600'
  )

  let overwriteRejected = false
  try {
    await execFile('bash', [
      generator,
      '--mode',
      'compose',
      '--output',
      composeOutput
    ])
  } catch {
    overwriteRejected = true
  }
  requireCondition(
    overwriteRejected,
    'generator must refuse to overwrite existing output'
  )

  const cloudOutput = path.join(generatedRoot, 'cloud')
  await execFile('bash', [
    generator,
    '--mode',
    'cloud',
    '--output',
    cloudOutput
  ])
  const cloudWeb = parseDotenv(
    await readFile(path.join(cloudOutput, 'web.env'), 'utf8')
  )
  const cloudListener = parseDotenv(
    await readFile(path.join(cloudOutput, 'listener.env'), 'utf8')
  )

  for (const sharedKey of [
    'LISTENER_AUTH_SECRET',
    'LISTENER_REQUEST_AUTH_SECRET',
    'NWC_VAULT_SECRET'
  ]) {
    requireCondition(
      cloudWeb[sharedKey] === cloudListener[sharedKey],
      `cloud web/listener output must share ${sharedKey}`
    )
  }
  requireCondition(
    !('NIP57_NSEC' in composeEnv) &&
      !('NIP57_NSEC' in cloudWeb) &&
      !('NIP57_NSEC' in cloudListener),
    'generator must never emit a NIP-57 nsec environment variable'
  )
} finally {
  await rm(generatedRoot, { recursive: true, force: true })
}

console.log('Deployment environment contract is consistent.')
