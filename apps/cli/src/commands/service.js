import { parseArgs } from 'node:util'
import { findRepoRoot } from '../lib/paths.js'
import { readInstallState } from '../lib/state.js'
import {
  detectDockerEnvironment,
  printDockerStatus,
  startDockerStack,
  stopDockerStack
} from '../lib/docker.js'
import {
  printStatusSummary,
  restartNativeRuntime,
  startNativeRuntime,
  stopNativeRuntime
} from '../lib/native-service.js'

function printServiceHelp() {
  console.log(`lawallet service

Usage:
  lawallet service <start|status|stop|restart>
  lawallet service status --cwd /path/to/lawallet-nwc
`)
}

function parseServiceArguments(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      cwd: { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  })

  if (values.help) {
    return { help: true }
  }

  const action = positionals[0] || 'status'

  if (!['start', 'status', 'stop', 'restart'].includes(action)) {
    throw new Error(`Unsupported service action: ${action}`)
  }

  return {
    help: false,
    action,
    cwd: values.cwd
  }
}

export async function runServiceCommand(args) {
  const options = parseServiceArguments(args)

  if (options.help) {
    printServiceHelp()
    return
  }

  const repoRoot = findRepoRoot(options.cwd || process.cwd())
  const state = await readInstallState(repoRoot)

  if (!state) {
    throw new Error(
      `No LaWallet install metadata was found under ${repoRoot}. Run "lawallet install" first.`
    )
  }

  if (state.mode === 'docker') {
    const dockerEnvironment = await detectDockerEnvironment()

    if (!dockerEnvironment) {
      throw new Error('Docker mode is configured for this install, but Docker is not available.')
    }

    switch (options.action) {
      case 'start':
        await startDockerStack(state, dockerEnvironment)
        break
      case 'stop':
        await stopDockerStack(state, dockerEnvironment)
        break
      case 'restart':
        await stopDockerStack(state, dockerEnvironment)
        await startDockerStack(state, dockerEnvironment)
        break
      case 'status':
        break
      default:
        break
    }

    await printDockerStatus(state, dockerEnvironment)
    return
  }

  switch (options.action) {
    case 'start':
      await startNativeRuntime(state)
      break
    case 'stop':
      await stopNativeRuntime(state)
      break
    case 'restart':
      await restartNativeRuntime(state)
      break
    case 'status':
      break
    default:
      break
  }

  await printStatusSummary(state)
}
