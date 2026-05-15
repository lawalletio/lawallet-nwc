import { commandExists, runCommand, waitForHttp } from './process.js'

export async function detectDockerEnvironment() {
  const hasDocker = commandExists('docker')
  const hasLegacyCompose = commandExists('docker-compose')

  if (hasDocker) {
    try {
      await runCommand('docker', ['info'], {
        capture: true
      })
    } catch {
      return null
    }

    try {
      await runCommand('docker', ['compose', 'version'], {
        capture: true
      })

      return {
        command: 'docker',
        args: ['compose']
      }
    } catch {
      if (hasLegacyCompose) {
        try {
          await runCommand('docker-compose', ['version'], {
            capture: true
          })

          return {
            command: 'docker-compose',
            args: []
          }
        } catch {
          return null
        }
      }

      return null
    }
  }

  if (!hasLegacyCompose) {
    return null
  }

  try {
    await runCommand('docker-compose', ['version'], {
      capture: true
    })

    return {
      command: 'docker-compose',
      args: []
    }
  } catch {
    return null
  }
}

async function runCompose(state, dockerEnvironment, args, options = {}) {
  return runCommand(dockerEnvironment.command, [...dockerEnvironment.args, ...args], {
    cwd: state.repoRoot,
    ...options
  })
}

function parseComposeStatus(raw) {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => ({ summary: line }))
  }
}

export async function startDockerStack(state, dockerEnvironment) {
  await runCompose(state, dockerEnvironment, ['up', '-d', '--build'])
  await waitForHttp(state.app.healthUrl)
}

export async function stopDockerStack(state, dockerEnvironment) {
  await runCompose(state, dockerEnvironment, ['stop'])
}

export async function printDockerStatus(state, dockerEnvironment) {
  const result = await runCompose(
    state,
    dockerEnvironment,
    ['ps', '--format', 'json'],
    { capture: true, allowFailure: true }
  )

  const containers = parseComposeStatus(result.stdout)

  console.log(`LaWallet status

Mode: docker
Install path: ${state.repoRoot}
URL: ${state.app.url}
Port: ${state.app.port}
Database: ${state.postgres.database}
Database host/port: ${state.postgres.host}:${state.postgres.port}`)

  if (containers.length > 0) {
    console.log('\nContainers:')

    for (const container of containers) {
      if (container.summary) {
        console.log(`  - ${container.summary}`)
        continue
      }

      const name = container.Name || container.Service || 'unknown'
      const status = container.State || container.Status || 'unknown'
      console.log(`  - ${name}: ${status}`)
    }
  }
}
