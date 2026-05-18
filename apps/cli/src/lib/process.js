import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'

export function commandExists(command) {
  return spawnSync('which', [command], {
    stdio: 'ignore'
  }).status === 0
}

export async function runCommand(command, args, options = {}) {
  const {
    cwd,
    env,
    capture = false,
    allowFailure = false,
    stdio = 'inherit'
  } = options

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : stdio
    })

    let stdout = ''
    let stderr = ''

    if (capture) {
      child.stdout.on('data', chunk => {
        stdout += chunk.toString()
      })

      child.stderr.on('data', chunk => {
        stderr += chunk.toString()
      })
    }

    child.on('error', reject)
    child.on('close', code => {
      if (code === 0 || allowFailure) {
        resolve({
          code: code ?? 0,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        })
        return
      }

      reject(
        new Error(
          `Command failed (${command} ${args.join(' ')}): ${stderr.trim() || `exit code ${code}`}`
        )
      )
    })
  })
}

export async function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.once('listening', () => {
      server.close(() => resolve(true))
    })

    server.listen(port, '127.0.0.1')
  })
}

export async function findAvailablePort(startPort, attempts = 20) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset

    if (await isPortAvailable(port)) {
      return port
    }
  }

  throw new Error(`Could not find an available port starting at ${startPort}.`)
}

export function isProcessRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

export async function waitForHttp(url, timeoutMs = 90_000) {
  if (process.env.LAWALLET_SKIP_HTTP_WAIT === 'true') {
    return true
  }

  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5_000)
      })

      if (response.ok) {
        return true
      }
    } catch {}

    await sleep(1_500)
  }

  throw new Error(`Timed out waiting for ${url} to respond.`)
}
