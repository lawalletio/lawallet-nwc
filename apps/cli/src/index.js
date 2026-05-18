#!/usr/bin/env node

import process from 'node:process'
import { runInstallCommand } from './commands/install.js'
import { runServiceCommand } from './commands/service.js'

function printHelp() {
  console.log(`LaWallet CLI

Usage:
  lawallet install [options]
  lawallet service <start|status|stop|restart> [options]

Install options:
  --dir, -d <path>         Base directory to clone into (default: current dir)
  --mode <auto|docker|native>
  --repo <git-url-or-path>
  --app-port <port>        Web app port
  --docs-port <port>       Docs app port
  --openapi-port <port>    OpenAPI app port
  --postgres-port <port>   Docker host Postgres port
  --yes, -y                Skip interactive prompts

Service options:
  --cwd <path>             Resolve the repo from a different directory
`)
}

function validateNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number)

  if (major > 20 || (major === 20 && minor >= 13)) {
    return { major, minor }
  }

  throw new Error('LaWallet CLI requires Node.js 20.13.0 or newer.')
}

async function main(argv) {
  const version = validateNodeVersion()

  if (version.major < 22 || (version.major === 22 && version.minor < 14)) {
    console.warn(
      'Note: the LaWallet repo is pinned to Node.js 22.14.0 in .nvmrc; continuing with the current Node runtime for the CLI.'
    )
  }

  const [command, ...rest] = argv

  switch (command) {
    case 'install':
      await runInstallCommand(rest)
      return
    case 'service':
      await runServiceCommand(rest)
      return
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp()
      return
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

main(process.argv.slice(2)).catch(error => {
  console.error(`\nLaWallet CLI error: ${error.message}`)

  if (process.env.LAWALLET_DEBUG === 'true' && error.stack) {
    console.error(error.stack)
  }

  process.exit(1)
})
